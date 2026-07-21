# 🤖 Job Application Assistant

An autonomous job application assistant comprising a MV3 Chrome Extension and a local sync Express backend.

## 📂 Structure
* **`backend/`**: Sync server (Express, SQLite, Prisma) running on Port `5000`.
* **`extension/`**: MV3 Chrome Extension for automated form filling.

## 🚀 Getting Started

### 📋 Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [Google Gemini API Key](https://ai.google.dev/) (required for semantic autofills)

### Step 1: Install Dependencies
From the root directory, install workspace packages:
```bash
npm install
```

### Step 2: Initialize Database & Run Backend
```bash
# Navigate to the backend directory
cd backend

# Push schema and generate Prisma client
npx prisma db push

# Start backend server (Port 5000)
npm run dev
```

### Step 3: Install the Chrome Extension
1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn **ON** the **Developer mode** toggle in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the **`extension/`** folder.

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
