#include "control_json.h"
#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static void ws(const char **p) { while (**p==' '||**p=='\t'||**p=='\r'||**p=='\n') (*p)++; }
static int hex4(const char **p, unsigned *out) {
    unsigned n=0;
    for (int i=0;i<4;i++) {
        unsigned char c=(unsigned char)**p; unsigned d;
        if (c>='0'&&c<='9') d=c-'0';
        else if (c>='a'&&c<='f') d=c-'a'+10;
        else if (c>='A'&&c<='F') d=c-'A'+10;
        else return -1;
        n=n*16+d; (*p)++;
    }
    *out=n; return 0;
}
/* Only ASCII field names/enum values are meaningful. Non-ASCII stays nonmatching.
 * The logical length prevents embedded NUL or long strings matching a prefix. */
static int string_value(const char **p, char *out, size_t cap, size_t *length) {
    if (*(*p)++!='"') return -1;
    size_t n=0;
    while (**p && **p!='"') {
        unsigned char c=(unsigned char)*(*p)++;
        if (c<0x20) return -1;
        if (c=='\\') {
            c=(unsigned char)*(*p)++;
            if (!c) return -1;
            switch (c) {
            case '"': case '\\': case '/': break;
            case 'b': c='\b'; break; case 'f': c='\f'; break;
            case 'n': c='\n'; break; case 'r': c='\r'; break; case 't': c='\t'; break;
            case 'u': {
                unsigned cp;
                if (hex4(p,&cp)) return -1;
                if (cp>=0xD800&&cp<=0xDBFF) {
                    unsigned low;
                    if ((*p)[0]!='\\'||(*p)[1]!='u') return -1;
                    *p+=2;
                    if (hex4(p,&low)||low<0xDC00||low>0xDFFF) return -1;
                    cp=0x10000;
                } else if (cp>=0xDC00&&cp<=0xDFFF) return -1;
                c=cp<128?(unsigned char)cp:0xFF; break;
            }
            default: return -1;
            }
        }
        if (n+1<cap) out[n]=(char)c;
        n++;
    }
    if (**p!='"') return -1;
    (*p)++;out[n<cap?n:cap-1]='\0';*length=n;return 0;
}
static int equal(const char *s,size_t n,const char *expected) {
    return n==strlen(expected)&&memcmp(s,expected,n)==0;
}
int ps_parse_control_json(const char *body, ps_control_patch_t *patch) {
    static const char *keys[PS_CTL_COUNT]={"prio_inherit_enabled","fault_prio_inversion",
        "fault_reply_stall","fault_cpu_hog","tick_period_ms","stall_ms","scope_mode","scope_pid","reset"};
    const char *p=body; memset(patch,0,sizeof(*patch));ws(&p);
    if (*p++!='{') return -1;
    ws(&p);
    if (*p!='}') for (;;) {
        char key[64],str[64];size_t klen=0,slen=0;
        if (*p!='"'||string_value(&p,key,sizeof(key),&klen)) return -1;
        ws(&p);if (*p++!=':') return -1;ws(&p);
        int kind=0; /* 1 string, 2 bool, 3 integer, 4 other valid scalar */
        long val=0;
        if (*p=='"') { if (string_value(&p,str,sizeof(str),&slen)) return -1;kind=1; }
        else if (strncmp(p,"true",4)==0) {p+=4;kind=2;val=1;}
        else if (strncmp(p,"false",5)==0) {p+=5;kind=2;val=0;}
        else if (strncmp(p,"null",4)==0) {p+=4;kind=4;}
        else {
            const char *start=p;
            if (*p=='-') p++;
            if (*p=='0') p++;
            else if (*p>='1'&&*p<='9') { do {p++;} while (isdigit((unsigned char)*p)); }
            else return -1;
            kind=3;
            if (*p=='.') {kind=4;p++;if (!isdigit((unsigned char)*p)) return -1;while (isdigit((unsigned char)*p))p++;}
            if (*p=='e'||*p=='E') {kind=4;p++;if (*p=='+'||*p=='-')p++;if (!isdigit((unsigned char)*p))return -1;while (isdigit((unsigned char)*p))p++;}
            if (kind==3) {errno=0;char *tail;val=strtol(start,&tail,10);if (errno==ERANGE||tail!=p)kind=4;}
        }
        int field=-1;
        for (int i=0;i<PS_CTL_COUNT;i++) if (equal(key,klen,keys[i])) {field=i;break;}
        if (field>=0) {
            uint32_t bit=1U<<field;
            if (patch->present&bit) return -1; /* Duplicate control members are ambiguous. */
            if (field<=PS_CTL_HOG||field==PS_CTL_RESET) {if (kind!=2)return -1;}
            else if (field==PS_CTL_SCOPE&&kind==1) {
                if (equal(str,slen,"lab")) val=0;
                else if (equal(str,slen,"all"))val=1;
                else if (equal(str,slen,"pid"))val=2;
                else return -1;
            } else if (kind!=3||val<0||val>INT_MAX) return -1;
            if (field==PS_CTL_SCOPE&&(val<0||val>2))return -1;
            patch->present|=bit;patch->value[field]=(int32_t)val;
        }
        ws(&p);if (*p=='}')break;if (*p++!=',')return -1;ws(&p);
    }
    if (*p++!='}') return -1;
    ws(&p);
    if (*p) return -1;
    if (patch->value[PS_CTL_RESET]&&(patch->present&~(1U<<PS_CTL_RESET)))return -1;
    return 0;
}
int ps_http_content_length(const char *headers,size_t length,size_t *content_length) {
    const char *end=headers+length,*p=memchr(headers,'\r',length);
    int seen=0;*content_length=0;
    if (!p) return 0; /* No header fields; caller provided the complete header boundary. */
    if (p+1>=end||p[1]!='\n')return -1;
    p+=2;
    while (p<end) {
        const char *e=memchr(p,'\r',(size_t)(end-p));if (!e)e=end;
        if (e<end&&(e+1>=end||e[1]!='\n'))return -1;
        const char *colon=memchr(p,':',(size_t)(e-p));if (!colon||colon==p)return -1;
        for (const char *k=p;k<colon;k++)if (!isalnum((unsigned char)*k)&&*k!='-')return -1;
        size_t name_len=(size_t)(colon-p);const char *v=colon+1;
        for (const char *k=v;k<e;k++) if (((unsigned char)*k<0x20&&*k!='\t')||(unsigned char)*k==0x7F) return -1;
        while (v<e&&(*v==' '||*v=='\t'))v++;
        if (name_len==17&&strncasecmp(p,"Transfer-Encoding",17)==0)return -1;
        if (name_len==14&&strncasecmp(p,"Content-Length",14)==0) {
            if (seen++||v==e||!isdigit((unsigned char)*v))return -1;
            size_t n=0;
            while (v<e&&isdigit((unsigned char)*v)) {n=n*10+(size_t)(*v++-'0');if(n>8191)return -1;}
            while (v<e&&(*v==' '||*v=='\t'))v++;
            if (v!=e) return -1;
            *content_length=n;
        }
        p=e<end?e+2:end;
    }
    return 0;
}
