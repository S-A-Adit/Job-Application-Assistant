const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { encrypt, decrypt } = require('../utils/crypto');

async function seedDatabase() {
  try {
    console.log('Running database seeding check...');

    // 1. Seed Settings from .env
    const existingSettings = await prisma.settings.findUnique({ where: { id: 'singleton' } });
    let settingsData = {};
    if (existingSettings) {
      try {
        const decrypted = decrypt(existingSettings.dataJson);
        if (decrypted) {
          settingsData = JSON.parse(decrypted);
        } else {
          settingsData = JSON.parse(existingSettings.dataJson);
        }
      } catch (e) {
        console.warn('Failed to decrypt/parse existing settings, using empty defaults.');
      }
    }

    if (process.env.GEMINI_API_KEY) {
      settingsData.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      settingsData.GROQ_API_KEY = settingsData.GROQ_API_KEY || "";
      settingsData.GEMINI_MODEL = "gemini-2.5-flash";
      settingsData.DEFAULT_PORTAL_EMAIL = settingsData.DEFAULT_PORTAL_EMAIL || process.env.USERNAME || "";
      settingsData.DEFAULT_PORTAL_PASSWORD = settingsData.DEFAULT_PORTAL_PASSWORD || process.env.PASSWORD || "";

      await prisma.settings.upsert({
        where: { id: 'singleton' },
        update: { dataJson: encrypt(JSON.stringify(settingsData)) },
        create: { id: 'singleton', dataJson: encrypt(JSON.stringify(settingsData)) }
      });
      console.log('Seeded/Updated Settings from .env variables (encrypted).');
    } else if (!existingSettings) {
      const defaultSettings = {
        GEMINI_API_KEY: "",
        GROQ_API_KEY: "",
        GEMINI_MODEL: "gemini-2.5-flash",
        DEFAULT_PORTAL_EMAIL: "",
        DEFAULT_PORTAL_PASSWORD: ""
      };
      await prisma.settings.create({
        data: {
          id: 'singleton',
          dataJson: encrypt(JSON.stringify(defaultSettings))
        }
      });
      console.log('Seeded default empty Settings (encrypted).');
    }

    // Load backup data if available (checking backend/data/ then backend/)
    let backupPath = path.join(__dirname, '../../data/ai_job_agent_backup_1783188783994.json');
    if (!fs.existsSync(backupPath)) {
      backupPath = path.join(__dirname, '../../ai_job_agent_backup_1783188783994.json');
    }

    let backupData = null;
    if (fs.existsSync(backupPath)) {
      try {
        backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        console.log('Loaded seed data from backup file.');
      } catch (err) {
        console.error('Failed to parse backup JSON file:', err);
      }
    }

    // 2. Seed Profile
    const profileCount = await prisma.profile.count();
    if (profileCount === 0) {
      let profileData = {};
      if (backupData && backupData.profile) {
        profileData = backupData.profile;
      } else {
        profileData = {
          name: "Test User",
          contact: { email: "test@example.com", phone: "123-456-7890", firstName: "Test", lastName: "User" },
          skills: ["JavaScript", "React", "Node.js"]
        };
      }
      await prisma.profile.create({
        data: {
          id: 'singleton',
          dataJson: encrypt(JSON.stringify(profileData))
        }
      });
      console.log('Seeded Profile database table (encrypted).');
    }

    // 3. Seed Cover Letters
    const coverLettersCount = await prisma.coverLetter.count();
    if (coverLettersCount === 0 && backupData && Array.isArray(backupData.coverLetters)) {
      for (const letter of backupData.coverLetters) {
        await prisma.coverLetter.create({
          data: {
            id: letter.id || undefined,
            name: letter.name,
            text: letter.text,
            analysis: letter.analysis ? JSON.stringify(letter.analysis) : null
          }
        });
      }
      console.log(`Seeded ${backupData.coverLetters.length} Cover Letters.`);
    }

    // 4. Seed Active Resume
    const resumeCount = await prisma.resume.count();
    if (resumeCount === 0) {
      const filename = "Afnan_Adit_Resume.pdf";
      const dummyBase64 = "JVBERi0xLjQKMSAwIG9iagogIDw8IC9UeXBlIC9DYXRhbG9nCiAgICAgL1BhZ2VzIDIgMCBSCiAgPj4KZW5kb2JqCjIgMCBvYmoKICA8PCAvVHlwZSAvUGFnZXMKICAgICAvS2lkcyBbIDMgMCBSIF0KICAgICAvQ291bnQgMQogID4+CmVuZG9iagozIDAgb2JqCiAgPDwgL1R5cGUgL1BhZ2UKICAgICAvUGFyZW50IDIgMCBSCiAgICAgL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXQogICAgIC9Db250ZW50cyA0IDAgUgogID4+CmVuZG9iago0IDAgb2JqCiAgPDwgL0xlbmd0aCA1NiA+PgpzdHJlYW0KQlQKICAvRjEgMTIgVGYKICA3MiA3MTIgVGQKICAoRHVtbXkgUmVzdW1lIGZvciBBSSBKb2IgQWdlbnQgVGVzdTestingIFgoKRUQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA2OSAwMDAwMCBuIAowMDAwMDAwMTMwIDAwMDAwIG4gCjAwMDAwMDAyMjUgMDAwMDAgbiAKdHJhaWxlcgogIDw8IC9TaXplIDUKICAgICAvUm9vdCAxIDAgUgogID4+CnN0YXJ0eHJlZgozMzAKJSVFT0Y=";
      await prisma.resume.create({
        data: {
          versionName: filename,
          filePath: `uploads/${filename}`,
          parsedJson: '{}',
          base64Data: dummyBase64
        }
      });
      console.log('Seeded active Resume PDF.');
    }
  } catch (err) {
    console.error('Error seeding database:', err);
  }
}

module.exports = seedDatabase;
