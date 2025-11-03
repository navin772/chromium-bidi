/*
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview smoke test for Selenium integration.
 *
 * Runs Selenium with the latest CfT + ChromeDriver + current Mapper version.
 * Inspired by https://github.com/SeleniumHQ/selenium/blob/0c86525184355bddc44b6193ae7236f11a7fb129/javascript/node/selenium-webdriver/test/bidi/bidi_test.js#L300
 */

import * as assert from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';

import {Builder, ScriptManager, BrowsingContext} from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

import {
  installAndGetChromePath,
  installAndGetChromeDriverPath,
  getBidiMapperPath,
} from '../tools/path-getter/path-getter.mjs';

const chromePath = installAndGetChromePath();
const chromeDriverPath = installAndGetChromeDriverPath();
const chromeLogPath = '/tmp/chrome-debug.log';

const chromeService = new chrome.ServiceBuilder(chromeDriverPath)
  .addArguments(`--bidi-mapper-path=${getBidiMapperPath()}`)
  .addArguments('--verbose')
  .addArguments('--log-path=/tmp/chromedriver.log');

const driver = new Builder()
  .forBrowser('chrome')
  .setChromeOptions(
    new chrome.Options()
      .enableBidi()
      .addArguments('--disable-gpu')
      .addArguments('--enable-logging=stderr')
      .addArguments('--v=1')
      .addArguments(`--log-file=${chromeLogPath}`)
      // .addArguments('--no-sandbox')
      // .addArguments('--disable-dev-shm-usage')
      .setChromeBinaryPath(chromePath)
      .setLoggingPrefs({browser: 'ALL', driver: 'ALL'}),
  )
  .setChromeService(chromeService)
  .build();

try {
  // Create a tab.
  const browsingContext = await BrowsingContext(driver, {
    type: 'tab',
  });

  // Navigate tab to some page.
  await browsingContext.navigate(
    'data:text/html,<h1>SOME PAGE</h1>',
    'complete',
  );

  const scriptManager = await ScriptManager(browsingContext, driver);

  // Get header element reference.
  const evaluateResult = await scriptManager.evaluateFunctionInBrowsingContext(
    browsingContext.id,
    '(document.getElementsByTagName("h1")[0])',
    false,
    'root',
  );
  assert.strictEqual(evaluateResult.resultType, 'success');
  const elementId = evaluateResult.result.sharedId;

  // Get screenshot of the element.
  console.log('\n===== Attempting screenshot… =====');

  try {
    const response = await browsingContext.captureElementScreenshot(elementId);

    console.log(
      '✅ Raw BiDi screenshot response:\n',
      JSON.stringify(response, null, 2),
    );

    if (!response || !response.slice) {
      console.error(
        '❌ Unexpected response format — no base64 screenshot found!',
      );
      throw new Error(
        'Screenshot missing Base64 data (likely a Chromium BiDi regression)',
      );
    }

    const base64code = response.slice(0, 5);
    console.log('📌 Screenshot prefix:', base64code);

    assert.equal(base64code, 'iVBOR'); // PNG signature

    // Retrieve and display browser logs
    try {
      const logs = await driver.manage().logs().get('browser');
      console.log('\n===== Chrome Browser Logs =====');
      logs.forEach((entry) => {
        console.log(`[${entry.level.name}] ${entry.message}`);
      });
    } catch (logErr) {
      console.error('Failed to retrieve browser logs:', logErr.message);
    }
  } catch (err) {
    console.error('❌ Screenshot failed with error:\n', err);

    // Try to get logs on error
    try {
      const logs = await driver.manage().logs().get('browser');
      console.log('\n===== Chrome Browser Logs (on error) =====');
      logs.forEach((entry) => {
        console.log(`[${entry.level.name}] ${entry.message}`);
      });
    } catch (logErr) {
      console.error('Failed to retrieve logs:', logErr.message);
    }

    throw err;
  }

  // Constants for checking the file format.
  // const startIndex = 0;
  // const endIndex = 5;
  // const pngMagicNumber = 'iVBOR';
  //
  // const base64code = response.slice(startIndex, endIndex);
  // assert.equal(base64code, pngMagicNumber);
  // sleep for 3 sec
  await new Promise((resolve) => setTimeout(resolve, 2000));
} finally {
  await driver.quit();

  // Print Chrome logs after quit
  console.log('\n===== Chrome Debug Logs =====');
  if (existsSync(chromeLogPath)) {
    const logs = readFileSync(chromeLogPath, 'utf-8');
    console.log(logs);
  } else {
    console.log('No Chrome log file found at:', chromeLogPath);
  }

  console.log('\n===== ChromeDriver Logs =====');
  if (existsSync('/tmp/chromedriver.log')) {
    const driverLogs = readFileSync('/tmp/chromedriver.log', 'utf-8');
    console.log(driverLogs);
  } else {
    console.log('No ChromeDriver log file found');
  }
}
