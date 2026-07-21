const crypto = require('crypto');

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const DEFAULT_SEED = 'ai-job-agent-default-secret-seed-value';

function getEncryptionKey(customSeed) {
  const seed = customSeed || process.env.PASSWORD || process.env.ENCRYPTION_SECRET || DEFAULT_SEED;
  return crypto.scryptSync(seed, 'salt-job-agent', 32);
}

function encrypt(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return encryptedText; // Fallback for legacy plain text data

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  // Primary attempt with current environment key
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // Secondary fallback attempt with default seed if password changed
    try {
      const fallbackKey = getEncryptionKey(DEFAULT_SEED);
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, fallbackKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (fallbackErr) {
      console.error('Failed to decrypt data, returning null:', fallbackErr.message);
      return null;
    }
  }
}

module.exports = { encrypt, decrypt };
