import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const keyDir = path.join(config.dataDir, 'keys');
export const privateKeyPath = path.join(keyDir, 'private-key.pem');
export const publicKeyPath = path.join(keyDir, 'com.tesla.3p.public-key.pem');

function derivePublicKey(privatePem) {
  return crypto
    .createPublicKey(privatePem)
    .export({ type: 'spki', format: 'pem' })
    .toString();
}

// 컨테이너 최초 실행 시 EC(prime256v1) 키쌍을 자동 생성합니다.
// 이미 키가 있으면 그대로 두고, 개인키만 있으면 공개키를 다시 유도합니다.
export function ensureKeys() {
  fs.mkdirSync(keyDir, { recursive: true });

  if (fs.existsSync(privateKeyPath)) {
    if (!fs.existsSync(publicKeyPath)) {
      const privatePem = fs.readFileSync(privateKeyPath, 'utf8');
      fs.writeFileSync(publicKeyPath, derivePublicKey(privatePem));
      console.log('공개키를 기존 개인키에서 다시 생성했습니다.');
    }
    return;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    // openssl ec -genkey 와 동일한 SEC1 형식 (vehicle-command 프록시 호환)
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey);
  console.log(`키쌍을 새로 생성했습니다: ${keyDir}`);
  console.log('⚠️ private-key.pem 은 절대 외부에 공개하지 마세요.');
}
