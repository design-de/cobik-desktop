# Cobik Desktop

แอป Mac ที่เปิดมาเห็น **Cowork ทางซ้าย · Claude ทางขวา** — ฝัง Claude Agent SDK (Claude Code ในรูปไลบรารี)
ล็อกอินด้วยบัญชี Claude ของผู้ใช้เอง ไม่ต้องมี API key

แผนเต็ม: `cobik-app/docs/plans/cobik-desktop.md`

## รัน

```bash
npm install
npm start                        # ต่อเว็บ prod
COBIK_TARGET=local npm run dev   # ต่อ localhost:3000 (ตอนแก้หน้าแผง)
COBIK_URL=https://… npm start    # ชี้ที่อยู่อื่นชั่วคราว
```

**ย้ายโดเมน/เปลี่ยนชื่อโปรเจกต์บน Vercel แล้ว URL เปลี่ยน?**
แก้ `appUrl` ใน `~/Library/Application Support/cobik-desktop/ui.json` ได้เลย
ไม่ต้อง build แอปใหม่ ไม่ต้องให้ทุกคนอัปเดต — ลำดับที่แอปใช้คือ
`COBIK_TARGET=local` → `COBIK_URL` → `ui.json:appUrl` → ค่าตั้งต้นในโค้ด

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

**สะพาน v1** — `window.cobik`

| | |
|---|---|
| `version` | เลขเวอร์ชันสะพาน (หน้าแผงเช็คว่าตรงกับที่ต้องการไหม) |
| `getState()` | `{ bridgeVersion, target, webUrl }` |
| `navigate(path)` | สั่งฝั่งซ้ายไปหน้าอื่น (กันหลุดออกนอกโดเมนเรา) |
| `reloadWeb()` | โหลดฝั่งซ้ายซ้ำ |
| `setPanelWidth(px)` | ปรับความกว้างแผง (320–900) |
| `onWebUrl(cb)` | ฝั่งซ้ายเปลี่ยนหน้า → แผครู้ (ใช้ทำชิป "กำลังดู") |

cookie ของ Cowork อยู่ใน partition `persist:cobik` → ล็อกอินครั้งเดียว ปิดเปิดแอปแล้วยังอยู่

## สถานะ (ปิดโต๊ะ 2026-09-18)

**เฟส 1 + ทาง A ปิดครบ** — พิมพ์ในแผง → Claude เรียก tool ของ Cowork → ข้อมูลเปลี่ยนในฝั่งซ้าย
ไม่ใช้ API key ของ Claude เลย (ขี่ login ของผู้ใช้ในเครื่อง)

ทำแล้ว
- [x] เปลือกสองฝั่ง + สะพาน v1 (ฝั่งแผงเต็ม · ฝั่งเว็บเล็ก `preload-web.js`)
- [x] OAuth PKCE loopback → token ใน Keychain · ต่ออายุเอง
- [x] Agent SDK แบบ streaming input — สตรีมทีละคำ · ปุ่มหยุด · สลับโมเดลกลางทาง
- [x] เลือกโมเดล/ระดับความคิด **จากบัญชีจริง** (`supportedModels`)
- [x] `/` เรียก skill (`supportedCommands`) · แนบไฟล์ · เพิ่มโฟลเดอร์ในเครื่อง
- [x] บทสนทนาทั้งหมด + กรุ + เปิดของเก่าคุยต่อ (อ่านจากที่ SDK เก็บ ไม่เก็บซ้ำ)
- [x] หุบแผงดูงานเต็มจอ · เริ่มแบบหุบ · จำสถานะ · ลากขอบ · ⌘/ ⌘1-3
- [x] แผงย้ายไปเป็นหน้าในเว็บ `/desktop/panel` (ระบบดีไซน์ · ไทย/อังกฤษ · ไอคอนกลาง)
- [x] ปุ่ม ✨ บน Topbar = สวิตช์แผง + ซ่อน AiChat เดิม · แถบบนลากหน้าต่างได้ · หัวสูงเท่ากัน 52px
- [x] คำตอบไม่อยู่ในกล่อง + markdown จริง (ตัวแปลงเขียนเอง ไม่มี dependency)
- [x] ธีมตามฝั่งซ้าย · เว้นที่ปุ่มหน้าต่าง macOS

## ค้าง — ต้องทำก่อนใช้จริง

1. **rebrand เป็น Cobik** ← ทำที่แชทอื่น (แผน `cobik-app/docs/plans/rebrand-cobik.md`)
   ต้องเสร็จก่อน push ไม่งั้นแผงต้องมาแก้ชื่อซ้ำ
2. **🔴 `cobik-app` มี 35 commit ยังไม่ push** — ในนั้น **21 commit เป็น design-system v2
   (Tailwind v4 + Radix) ที่ session อื่นทำ ยังไม่มีใครตรวจ** แตะ globals.css / package.json /
   components/ui/* ทั้งชุด → ห้าม push โดยไม่ให้เจ้าของงานยืนยัน
3. **push แล้วประกอบเป็น `Cobik.app`** — ตอนนี้รันจาก terminal เท่านั้น ผู้ใช้เปิดเองไม่ได้
   และต้องมี dev server รันคู่ (ตายเองเป็นระยะ) · ประกอบแล้วชี้ prod = หายทั้งสองปัญหา
   ยังไม่ต้องมีบัญชี Apple (ไฟล์เกิดบนเครื่อง ไม่ติด quarantine)

## ยังไม่ได้ทำ (เฟสถัดไป)
- [ ] **skill 6 ตัวของ Cowork ติดมากับแอป** (เฟส 3) — ตอนนี้ `/` เห็นแต่ skill ส่วนตัวของผู้ใช้
- [ ] จำโฟลเดอร์ต่อโปรเจกต์ (ตอนนี้จำแค่ในรอบที่เปิดอยู่)
- [ ] permission prompt ตอนให้เขียนไฟล์/รัน Bash (v1 ปิดไว้ ใช้เฉพาะ tool ของ Cowork)
- [ ] local MCP 127.0.0.1 แบบ Lunagraph (เฟส 5)
- [ ] แจกให้ทีม + auto-update (เฟส 6)
