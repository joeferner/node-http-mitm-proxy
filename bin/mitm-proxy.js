#!/usr/bin/env node

'use strict';

var optimist = require('optimist');

var args = optimist
  .alias('h', 'help')
  .alias('h', '?')
  .options('port', {
    default: 80,
    describe: 'HTTP Port.'
  })
  .alias('p', 'port')
  .argv;

if (args.help) {
  optimist.showHelp();
  return process.exit(-1);
}

var proxy = require('../lib/proxy')();
proxy.onError(function(ctx, err) {
  if (!args.silent) {
    console.error('proxy error:', err);
  }
});
proxy.listen(args);
if (!args.silent) {
  console.log('proxy listening on ' + args.port);
}