#!/usr/bin/env node

'use strict';

var yargs = require('yargs');
var debug = require('debug')('http-mitm-proxy:bin');

var args = yargs
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
  yargs.showHelp();
  return process.exit(-1);
}

var proxy = require('../lib/proxy')();
proxy.onError(function(ctx, err, errorKind) {
  debug(errorKind, err);
});
proxy.listen(args, function(err) {
  if (err) {
    debug('Failed to start listening on port ' + args.port, err);
    return process.exit(1);
  }
  debug('proxy listening on ' + args.port);
});
