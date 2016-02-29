'use strict';

module.exports = {
   
  onCertificateRequired: function (hostname, callback) {
    var self = this;
    var wildcardHost = hostname.replace(/^(.+)(\.[^\.]{4,}(\.[^\.]{1,3})*\.[^\.]+)$/, function(match, group1, group2) {
      return group1.replace(/[^\.]+/g, '*') + group2;
    });
    var fileName = wildcardHost.replace(/\*/g, '_');
    return callback(null, {
      keyFile: self.sslCaDir + '/keys/' + fileName + '.key',
      certFile: self.sslCaDir + '/certs/' + fileName + '.pem',
      hosts: [wildcardHost]
    });
    return this;
  }
};