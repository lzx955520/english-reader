import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'**/*.e2e.ts',workers:1,timeout:60000,retries:0,reporter:[['list'],['html',{open:'never'}]],use:{trace:'retain-on-failure'}});
