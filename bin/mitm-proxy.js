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
  .options('httpsPort', {
    default: null,
    describe: 'HTTPS Port.'
  })
  .alias('p', 'port')
  .argv;

if (args.help) {
  optimist.showHelp();
  return process.exit(-1);
}

var proxy = require('../lib/proxy')();
proxy.onError(function(ctx, err) {
  console.error('proxy error:', err);
});
proxy.listen(args.port, args.httpsPort);
console.log('proxy listening on ' + args.port);
if (args.httpsPort) {
  console.log('proxy listening on ' + args.httpsPort);
}