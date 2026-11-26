import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', fullyParallel:false, workers:1, timeout:45000,
  reporter:[['list'],['json',{outputFile:'../docs/browser-tests.json'}]],
  use:{baseURL:'http://127.0.0.1:5193',viewport:{width:1440,height:1000},headless:true},
  webServer:{command:'npm run build && npm run preview -- --host 127.0.0.1 --port 5193 --strictPort',url:'http://127.0.0.1:5193',reuseExistingServer:false},
});
