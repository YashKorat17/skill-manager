import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketplaceList, parsePluginList, stripAnsi } from '../src/claude.js';
import { isNewer } from '../src/update.js';

const PLUGIN_OUTPUT = `Installed plugins:

  > caveman@caveman
    Version: ec83e5bace4c
    Scope: user
    Status: enabled

  > claude-mem@thedotmack
    Version: 13.13.1
    Scope: user
    Status: disabled
`;

const MARKETPLACE_OUTPUT = `Configured marketplaces:

  > claude-plugins-official
    Source: GitHub (anthropics/claude-plugins-official)

  > caveman
    Source: GitHub (JuliusBrussee/caveman)
`;

test('parses the plugin list block format', () => {
  const plugins = parsePluginList(PLUGIN_OUTPUT);

  assert.equal(plugins.length, 2);
  assert.deepEqual(plugins[0], {
    name: 'caveman',
    marketplace: 'caveman',
    id: 'caveman@caveman',
    version: 'ec83e5bace4c',
    scope: 'user',
    enabled: true
  });
  assert.equal(plugins[1].enabled, false);
});

test('parses the marketplace list block format', () => {
  const marketplaces = parseMarketplaceList(MARKETPLACE_OUTPUT);

  assert.deepEqual(
    marketplaces.map((market) => market.name),
    ['claude-plugins-official', 'caveman']
  );
  assert.equal(marketplaces[0].repo, 'anthropics/claude-plugins-official');
});

test('strips ANSI colors before parsing', () => {
  const esc = String.fromCharCode(27);
  assert.equal(stripAnsi(`${esc}[32mgreen${esc}[0m`), 'green');
});

test('compares versions numerically, not as strings', () => {
  assert.equal(isNewer('1.10.0', '1.9.0'), true);
  assert.equal(isNewer('1.2.0', '1.2.0'), false);
  assert.equal(isNewer('1.2.0', '1.3.0'), false);
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer(null, '1.0.0'), false);
});
