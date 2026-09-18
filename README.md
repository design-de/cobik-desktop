# Cobik Desktop

แอป Mac ที่เปิดมาเห็น **cobik ทางซ้าย · Claude ทางขวา** — ฝัง Claude Agent SDK (Claude Code ในรูปไลบรารี)
ล็อกอินด้วยบัญชี Claude ของผู้ใช้เอง ไม่ต้องมี API key

แผนเต็ม: `cobik-app/docs/plans/cobik-desktop.md`

## รัน (ตอนพัฒนา)

```bash
npm install
npm start                        # ต่อเว็บ prod
COBIK_TARGET=local npm run dev   # ต่อ localhost:3000 (ตอนแก้หน้าแผง)
COBIK_URL=https://… npm start    # ชี้ที่อยู่อื่นชั่วคราว
```

## ประกอบเป็น Cobik.app

```bash
npm run dist     # → dist/Cobik-<version>-arm64.dmg + dist/mac-arm64/Cobik.app
```

`npm run dist` ทำสามอย่างตามลำดับ: คัดลอก skill (`npm run skills`) → สร้างไอคอน (`npm run icon`) → ประกอบด้วย electron-builder
ทั้งหมดใช้ของที่ติดมากับ macOS (`sips`, `iconutil`) ไม่ต้องลงเครื่องมือเพิ่ม

**ยังไม่ได้เซ็นด้วย Developer ID** (`identity: null`) — เป็นแอด-ฮอกอย่างเดียว แปลว่า
- บนเครื่องที่ build เอง เปิดได้เลย
- ส่งไฟล์ให้คนอื่น macOS จะติด quarantine → คนรับต้อง **คลิกขวาที่ Cobik.app → Open → Open** ครั้งเดียว ครั้งต่อไปเปิดปกติ
- ถ้าอยากให้ดับเบิลคลิกจบและมี auto-update ต้องมี Apple Developer Program ($99/ปี) แล้วเซ็น+notarize (เฟส 6)

> ⚠️ ไม่ได้ pack เป็น asar (`asar: false`) ตั้งใจ — โปรเซสลูกของ Claude Code
> ต้องอ่านโฟลเดอร์ `skills-plugin/` ได้ตรง ๆ ไฟล์ที่อยู่ใน asar มันอ่านไม่เห็น

### skill ของทีมที่ติดมากับแอป

`skills-plugin/` คือสำเนาของ repo `cobik-skill` จัดเป็น **plugin ของ Claude Code** หนึ่งตัว
(`.claude-plugin/plugin.json` + `skills/cobik-*`) — Agent SDK โหลดเข้ามาแล้ว skill โผล่ในเมนู `/` ชื่อ `cobik:cobik-*`

ต้นทางเปลี่ยนเมื่อไหร่ ให้รัน `npm run skills` แล้ว commit สำเนาที่ได้
(สคริปต์หา `../cobik-skill` ก่อน ถอยไป `../cowork-skill` · หรือชี้เองด้วย `COBIK_SKILL_DIR=`)

### ⚠️ กับดัก: `ELECTRON_RUN_AS_NODE`

ถ้ารันจาก terminal ที่อยู่ข้างใน **VS Code / Claude Code** จะเจอ
`TypeError: Cannot read properties of undefined (reading 'handle')`

เพราะสภาพแวดล้อมนั้นตั้ง `ELECTRON_RUN_AS_NODE=1` ไว้ → Electron รันเป็น Node ธรรมดา
`require('electron')` เลยคืน **path ของไฟล์ไบนารี** แทนที่จะเป็น API (`app`, `ipcMain`, … เป็น undefined หมด)

แก้:
```bash
env -u ELECTRON_RUN_AS_NODE npx electron .
```
เปิดจาก Terminal.app ปกติไม่เจอปัญหานี้

> กลับด้านกัน: ตอนที่ main process ต้อง spawn Claude Code CLI ให้ Agent SDK
> **ลูกต้องมี `ELECTRON_RUN_AS_NODE=1`** ไม่งั้นมันจะเปิดหน้าต่าง Electron ใหม่แทนที่จะรันเป็น Node

## โครง

```
src/
  main.js            เปลือก: หน้าต่างเดียว แบ่ง WebContentsView สองตัว + ช่อง IPC
  preload.js         สะพาน window.cobik (v1) — หน้าแผงเห็นแค่นี้ ไม่มี node ดิบ
  panel/index.html   แผงชั่วคราวสำหรับพัฒนา → จะย้ายไป cobik-app /desktop/panel
```

**สะพาน v2** — `window.cobik`

| | |
|---|---|
| `version` | เลขเวอร์ชันสะพาน (หน้าแผงเช็คว่าตรงกับที่ต้องการไหม) |
| `getState()` | `{ bridgeVersion, target, webUrl }` |
| `navigate(path)` | สั่งฝั่งซ้ายไปหน้าอื่น (กันหลุดออกนอกโดเมนเรา) |
| `reloadWeb()` | โหลดฝั่งซ้ายซ้ำ |
| `setPanelWidth(px)` | ปรับความกว้างแผง (320–900) |
| `onWebUrl(cb)` | ฝั่งซ้ายเปลี่ยนหน้า → แผงรู้ (ใช้ทำชิป "กำลังดู") |
| `folders.*` | โฟลเดอร์ในเครื่อง — คืน `{ scope, folders }` · `onChange` ยิงเมื่อฝั่งซ้ายย้ายโปรเจกต์ |
| `answerAsk(id, answer)` | ตอบการ์ดขออนุญาต — `'allow'` \| `'always'` \| `'deny'` |

แผงอยู่บนเว็บ จึงเจอเปลือกรุ่นเก่าได้เสมอ — **ของใหม่ทุกตัวต้องเช็คก่อนเรียก** (`c.folders.onChange?.()`)

cookie ของ cobik อยู่ใน partition `persist:cobik` → ล็อกอินครั้งเดียว ปิดเปิดแอปแล้วยังอยู่

## สถานะ (2026-09-19)

**เฟส 1 · ทาง A · เฟส 3 ปิดครบ — และประกอบเป็น `Cobik.app` ได้แล้ว**
พิมพ์ในแผง → Claude เรียก tool ของ cobik → ข้อมูลเปลี่ยนในฝั่งซ้าย ไม่ใช้ API key เลย (ขี่ login ของผู้ใช้ในเครื่อง)

ทำแล้ว
- [x] เปลือกสองฝั่ง + สะพาน v2 (ฝั่งแผงเต็ม · ฝั่งเว็บเล็ก `preload-web.js`)
- [x] OAuth PKCE loopback → token ใน Keychain · ต่ออายุเอง
- [x] Agent SDK แบบ streaming input — สตรีมทีละคำ · ปุ่มหยุด · สลับโมเดลกลางทาง
- [x] เลือกโมเดล/ระดับความคิด **จากบัญชีจริง** (`supportedModels`)
- [x] `/` เรียก skill · แนบไฟล์ · เพิ่มโฟลเดอร์ในเครื่อง
- [x] บทสนทนาทั้งหมด + กรุ + เปิดของเก่าคุยต่อ (อ่านจากที่ SDK เก็บ ไม่เก็บซ้ำ)
- [x] หุบแผงดูงานเต็มจอ · เริ่มแบบหุบ · จำสถานะ · ลากขอบ · ⌘/ ⌘1-3
- [x] แผงเป็นหน้าในเว็บ `/desktop/panel` (ระบบดีไซน์ · ไทย/อังกฤษ · ไอคอนกลาง)
- [x] ปุ่ม ✨ บน Topbar = สวิตช์แผง · แถบบนลากหน้าต่างได้ · หัวสูงเท่ากัน 52px
- [x] คำตอบไม่อยู่ในกล่อง + markdown จริง · ธีมตามฝั่งซ้าย · เว้นที่ปุ่มหน้าต่าง macOS
- [x] **skill 6 ตัวของ cobik ติดมากับแอป** — เมนู `/` แยกหมวด "ของ cobik" กับ "ของคุณเอง"
- [x] **ขออนุญาตก่อนแตะเครื่อง** — เขียนไฟล์/รันคำสั่งขึ้นการ์ดให้กดตอบ · tool ของ cobik ไม่ถาม
- [x] **โฟลเดอร์จำแยกตามโปรเจกต์** และจำข้ามการปิด-เปิดแอป (`folders.json`)
- [x] **ประกอบเป็น Cobik.app + .dmg** พร้อมไอคอนแบรนด์ (`npm run dist`)

## ค้าง — ก่อนแจกทั้งทีม

1. **แผงต้องขึ้น prod ก่อน** — แผงโหลดจากเว็บ ของใหม่ (การ์ดขออนุญาต · หมวด skill · ป้ายโฟลเดอร์)
   จะมาถึงแอปก็ต่อเมื่อ `cobik-app` ถูก deploy แล้วเท่านั้น
2. **บอกวิธีเปิดครั้งแรก** — คลิกขวา → Open (ยังไม่ได้เซ็น) ใส่ไว้ในข้อความตอนส่งไฟล์ให้ทีม
3. **ทดลองใช้จริงสักรอบ** ก่อนส่งต่อ — โดยเฉพาะการ์ดขออนุญาตกับการสลับโปรเจกต์

## ยังไม่ได้ทำ (เฟสถัดไป)
- [ ] permission prompt แบบจำข้ามบทสนทนา (ตอนนี้ "ตลอด" = ตลอดรอบที่เปิดอยู่)
- [ ] local MCP 127.0.0.1 แบบ Lunagraph (เฟส 5)
- [ ] sign + notarize + auto-update (เฟส 6 · ต้องมี Apple Developer Program)
- [ ] Windows
