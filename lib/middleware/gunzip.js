'use strict';

var zlib = require('zlib');

module.exports = {
  onResponse: function(ctx, callback) {
    if (ctx.serverToProxyResponse.headers['content-encoding']
      && ctx.serverToProxyResponse.headers['content-encoding'].toLowerCase() == 'gzip') {
      delete ctx.serverToProxyResponse.headers['content-encoding'];
      ctx.addResponseFilter(zlib.createGunzip());
    }
    return callback();
  }
};

