/**
 * group1: subdomain
 * group2: domain.ext
 * exclude short domains (length < 4) to avoid catching double extensions (ex: net.au, co.uk, ...)
 */
import { ErrorCallback, IProxy } from "../types";

const HOSTNAME_REGEX = /^(.+)(\.[^.]{4,}(\.[^.]{1,3})*\.[^.]+)$/;

export default {
  onCertificateRequired(hostname: string, callback: ErrorCallback) {
    let rootHost = hostname;
    if (HOSTNAME_REGEX.test(hostname)) {
      rootHost = hostname.replace(/^[^.]+\./, "");
    }
    return callback(null, {
      keyFile: (<IProxy>this).sslCaDir + "/keys/_." + rootHost + ".key",
      certFile: (<IProxy>this).sslCaDir + "/certs/_." + rootHost + ".pem",
      hosts: ["*." + rootHost, rootHost],
    });
  },
};
