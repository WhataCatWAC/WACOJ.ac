#!/usr/bin/env node
require('@hydrooj/utils/lib/register');

const { default: hook } = require('require-resolve-hook');
const { bypass } = hook(/^(hydrooj|@hydrooj\/utils)/, (id) => bypass(() => require.resolve(id)));

require('./commands');
