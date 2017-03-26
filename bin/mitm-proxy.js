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
  .options('host', {
    describe: 'HTTP Listen Interface.'
  })
  .argv;

if (args.help) {
  optimist.showHelp();
  return process.exit(-1);
}

var proxy = require('../lib/proxy')();
proxy.onError(function(ctx, err, errorKind) {
  if (!args.silent) {
    console.error(errorKind, err);
  }
});
proxy.listen(args);
if (!args.silent) {
  console.log('proxy listening on ' + args.port);
}