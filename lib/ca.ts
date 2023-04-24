import FS from "fs";
import path from "path";
import Forge from "node-forge";
const { pki, md } = Forge;
import mkdirp from "mkdirp";
import async from "async";
import ErrnoException = NodeJS.ErrnoException;
import { CAOverrides, IProxyOptions } from "./types";

const CAattrs = [
  {
    name: "commonName",
    value: "NodeMITMProxyCA",
  },
  {
    name: "countryName",
    value: "Internet",
  },
  {
    shortName: "ST",
    value: "Internet",
  },
  {
    name: "localityName",
    value: "Internet",
  },
  {
    name: "organizationName",
    value: "Node MITM Proxy CA",
  },
  {
    shortName: "OU",
    value: "CA",
  },
];

const CAextensions = [
  {
    name: "basicConstraints",
    cA: true,
  },
  {
    name: "keyUsage",
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true,
  },
  {
    name: "extKeyUsage",
    serverAuth: true,
    clientAuth: true,
    codeSigning: true,
    emailProtection: true,
    timeStamping: true,
  },
  {
    name: "nsCertType",
    client: true,
    server: true,
    email: true,
    objsign: true,
    sslCA: true,
    emailCA: true,
    objCA: true,
  },
  {
    name: "subjectKeyIdentifier",
  },
];

const ServerAttrs = [
  {
    name: "countryName",
    value: "Internet",
  },
  {
    shortName: "ST",
    value: "Internet",
  },
  {
    name: "localityName",
    value: "Internet",
  },
  {
    name: "organizationName",
    value: "Node MITM Proxy CA",
  },
  {
    shortName: "OU",
    value: "Node MITM Proxy Server Certificate",
  },
];

const ServerExtensions = [
  {
    name: "basicConstraints",
    cA: false,
  },
  {
    name: "keyUsage",
    keyCertSign: false,
    digitalSignature: true,
    nonRepudiation: false,
    keyEncipherment: true,
    dataEncipherment: true,
  },
  {
    name: "extKeyUsage",
    serverAuth: true,
    clientAuth: true,
    codeSigning: false,
    emailProtection: false,
    timeStamping: false,
  },
  {
    name: "nsCertType",
    client: true,
    server: true,
    email: false,
    objsign: false,
    sslCA: false,
    emailCA: false,
    objCA: false,
  },
  {
    name: "subjectKeyIdentifier",
  },
] as any[];

export class CA {
  baseCAFolder!: string;
  certsFolder!: string;
  keysFolder!: string;
  CAcert!: ReturnType<typeof Forge.pki.createCertificate>;
  CAkeys!: ReturnType<typeof Forge.pki.rsa.generateKeyPair>;

  static create(caFolder, callback, overrides: IProxyOptions['caOverrides'] = {}) {
    const ca = new CA();
    ca.baseCAFolder = caFolder;
    ca.certsFolder = path.join(ca.baseCAFolder, "certs");
    ca.keysFolder = path.join(ca.baseCAFolder, "keys");
    mkdirp.sync(ca.baseCAFolder);
    mkdirp.sync(ca.certsFolder);
    mkdirp.sync(ca.keysFolder);
    async.series(
      [
        (callback) => {
          const exists = FS.existsSync(path.join(ca.certsFolder, "ca.pem"));
          if (exists) {
            ca.loadCA(callback);
          } else {
            ca.generateCA(callback, overrides);
          }
        },
      ],
      (err) => {
        if (err) {
          return callback(err);
        }
        return callback(null, ca);
      }
    );
  }

  randomSerialNumber() {
    // generate random 16 bytes hex string
    let sn = "";
    for (let i = 0; i < 4; i++) {
      sn += `00000000${Math.floor(Math.random() * 256 ** 4).toString(
        16
      )}`.slice(-8);
    }
    return sn;
  }

  getPem() {
    return pki.certificateToPem(this.CAcert);
  }

  generateCA(
    callback: (
      err?: ErrnoException | null | undefined,
      results?: unknown[] | undefined
    ) => void,
    overrides: IProxyOptions['caOverrides'],
  ) {
    const self = this;
    pki.rsa.generateKeyPair({ bits: 2048 }, (err, keys) => {
      if (err) {
        return callback(err);
      }
      const cert = pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = self.randomSerialNumber();
      const { notBefore, notAfter } = getNotBeforeAndNotAfter(overrides?.daysToExpire);
      cert.validity.notBefore = notBefore;
      cert.validity.notAfter = notAfter;
      const finalCAattrs = getFinalCAattrs(overrides);
      cert.setSubject(finalCAattrs);
      cert.setIssuer(finalCAattrs);
      cert.setExtensions(CAextensions);
      cert.sign(keys.privateKey, md.sha256.create());
      self.CAcert = cert;
      self.CAkeys = keys;
      const tasks = [
        FS.writeFile.bind(
          null,
          path.join(self.certsFolder, "ca.pem"),
          pki.certificateToPem(cert)
        ),
        FS.writeFile.bind(
          null,
          path.join(self.keysFolder, "ca.private.key"),
          pki.privateKeyToPem(keys.privateKey)
        ),
        FS.writeFile.bind(
          null,
          path.join(self.keysFolder, "ca.public.key"),
          pki.publicKeyToPem(keys.publicKey)
        ),
      ];
      async.parallel(tasks, callback);
    });
  }

  loadCA(callback: Function) {
    const self = this;
    async.auto(
      {
        certPEM(callback) {
          FS.readFile(path.join(self.certsFolder, "ca.pem"), "utf-8", callback);
        },
        keyPrivatePEM(callback) {
          FS.readFile(
            path.join(self.keysFolder, "ca.private.key"),
            "utf-8",
            callback
          );
        },
        keyPublicPEM(callback) {
          FS.readFile(
            path.join(self.keysFolder, "ca.public.key"),
            "utf-8",
            callback
          );
        },
      },
      (
        err,
        results:
          | { certPEM: string; keyPrivatePEM: string; keyPublicPEM: string }
          | undefined
      ) => {
        if (err) {
          return callback(err);
        }
        self.CAcert = pki.certificateFromPem(results!.certPEM);
        self.CAkeys = {
          privateKey: pki.privateKeyFromPem(results!.keyPrivatePEM),
          publicKey: pki.publicKeyFromPem(results!.keyPublicPEM),
        };
        return callback();
      }
    );
  }

  generateServerCertificateKeys(hosts: string | string[], cb) {
    const self = this;
    if (typeof hosts === "string") {
      hosts = [hosts];
    }
    const mainHost = hosts[0];
    const keysServer = pki.rsa.generateKeyPair(2048);
    const certServer = pki.createCertificate();
    certServer.publicKey = keysServer.publicKey;
    certServer.serialNumber = this.randomSerialNumber();
    certServer.validity.notBefore = new Date();
    certServer.validity.notBefore.setDate(
      certServer.validity.notBefore.getDate() - 1
    );
    certServer.validity.notAfter = new Date();
    certServer.validity.notAfter.setFullYear(
      certServer.validity.notBefore.getFullYear() + 1
    );
    const attrsServer = ServerAttrs.slice(0);
    attrsServer.unshift({
      name: "commonName",
      value: mainHost,
    });
    certServer.setSubject(attrsServer);
    certServer.setIssuer(this.CAcert.issuer.attributes);
    certServer.setExtensions(
      ServerExtensions.concat([
        {
          name: "subjectAltName",
          altNames: hosts.map((host) => {
            if (host.match(/^[\d.]+$/)) {
              return { type: 7, ip: host };
            }
            return { type: 2, value: host };
          }),
        },
      ])
    );
    certServer.sign(this.CAkeys.privateKey, md.sha256.create());
    const certPem = pki.certificateToPem(certServer);
    const keyPrivatePem = pki.privateKeyToPem(keysServer.privateKey);
    const keyPublicPem = pki.publicKeyToPem(keysServer.publicKey);
    FS.writeFile(
      `${this.certsFolder}/${mainHost.replace(/\*/g, "_")}.pem`,
      certPem,
      (error) => {
        if (error) {
          console.error(
            `Failed to save certificate to disk in ${self.certsFolder}`,
            error
          );
        }
      }
    );
    FS.writeFile(
      `${this.keysFolder}/${mainHost.replace(/\*/g, "_")}.key`,
      keyPrivatePem,
      (error) => {
        if (error) {
          console.error(
            `Failed to save private key to disk in ${self.keysFolder}`,
            error
          );
        }
      }
    );
    FS.writeFile(
      `${this.keysFolder}/${mainHost.replace(/\*/g, "_")}.public.key`,
      keyPublicPem,
      (error) => {
        if (error) {
          console.error(
            `Failed to save public key to disk in ${self.keysFolder}`,
            error
          );
        }
      }
    );
    // returns synchronously even before files get written to disk
    cb(certPem, keyPrivatePem);
  }

  getCACertPath() {
    return `${this.certsFolder}/ca.pem`;
  }
}

/**
 * Calculates the notBefore and notAfter dates for a certificate.
 * 
 * Should allow for a certificate to be valid for a minimum of 1 day and a maximum of 825 days.
 * 
 * @param days the number of days the certificate should be valid for
 */
function getNotBeforeAndNotAfter(days: number = 364) {
  const notBefore = new Date();
  const notAfter = new Date();
  notBefore.setDate(notBefore.getDate() - 1);
  notAfter.setDate(notAfter.getDate() + days);
  return { notBefore, notAfter };
}

function getFinalCAattrs(caOverrides: Omit<CAOverrides, 'daysToExpire'> = {}) {
  const res = CAattrs;
  for (const [key, value] of Object.entries(caOverrides)) {
    const attr = res.find((attr) => attr.name === key);
    if (attr) {
      attr.value = value;
    }
  }
  return res;
}

export default CA;
