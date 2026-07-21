const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_KEY_SEED = process.env.PASSWORD || process.env.ENCRYPTION_SECRET || 'ai-job-agent-default-secret-seed-value';
const ENCRYPTION_KEY = crypto.scryptSync(SECRET_KEY_SEED, 'salt-job-agent', 32);
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return encryptedText;
  }
}

async function main() {
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" }
  });
  if (!settings) {
    console.error("No settings found in database.");
    return;
  }

  const data = JSON.parse(decrypt(settings.dataJson));
  const apiKey = data.GEMINI_API_KEY;
  const model = data.GEMINI_MODEL || "gemini-2.0-flash";

  if (!apiKey) {
    console.error("Gemini API key is empty in settings.");
    return;
  }

  console.log(`Attempting Gemini API call using key starting with ${apiKey.slice(0, 5)}...`);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Hello, reply with only the word SUCCESS."
                }
              ]
            }
          ]
        })
      }
    );

    const status = response.status;
    const text = await response.text();
    console.log(`Response Status: ${status}`);
    console.log("Response Body:");
    console.log(text);
  } catch (err) {
    console.error("Fetch request error:", err);
  }
}

main().finally(() => prisma.$disconnect());
