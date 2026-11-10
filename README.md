# ⚡ Winamp - Classic 2.91 Player with YouTube Music & Video

A faithful, lightweight recreation of the legendary **Winamp 2.91** built with modern web technologies (**React 19, TypeScript, Tailwind CSS, Vite**) and packaged as a desktop app with **Electron**.

Includes real-time YouTube & YouTube Music playback, classic equalizer, video window, custom playlist explorer, and pixel-perfect classic Winamp skins.

---

## ✨ Features

- **Classic Winamp 2.91 UI & Skins**: Authentic classic skins (`base`, `slate`, `llama`), draggable windows with snap mechanics, shaded mode, and retro font styling.
- **YouTube Music Integration**:
  - Connect your Google / YouTube Music account seamlessly.
  - Browse your Liked Songs, created playlists, and followed libraries.
  - Instant song search powered by local InnerTube integration.
- **Classic Audio Equalizer**: Interactive multi-band EQ with preamp slider and classic frequency bands.
- **Synchronized Video Window**: Detachable video monitor window for YouTube music videos.
- **Desktop Ready**: Runs standalone with Electron or in the browser via Vite dev server.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm`

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/aisoldati/winamp.git
   cd winamp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start in development mode (Vite):
   ```bash
   npm run dev
   ```

4. Or launch as Desktop App (Electron):
   ```bash
   npm run electron:dev
   ```

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Bundler**: Vite 6
- **Desktop Shell**: Electron 34+
- **APIs**: YouTube Music InnerTube & Google OAuth

---

## 📄 License

MIT License. Crafted with nostalgic love for the golden era of MP3s. *It really whips the llama's ass!* 🦙
