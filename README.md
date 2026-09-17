# Cobik Desktop

แอป Mac ที่เปิดมาเห็น **Cowork ทางซ้าย · Claude ทางขวา** — ฝัง Claude Agent SDK (Claude Code ในรูปไลบรารี)
ล็อกอินด้วยบัญชี Claude ของผู้ใช้เอง ไม่ต้องมี API key

แผนเต็ม: `cowork-app/docs/plans/cobik-desktop.md`

## รัน

```bash
npm install
npm start              # ต่อเว็บ prod
COBIK_TARGET=local npm run dev   # ต่อ localhost:3000 (ตอนแก้หน้าแผง)
```

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
  panel/index.html   แผงชั่วคราวสำหรับพัฒนา → จะย้ายไป cowork-app /desktop/panel
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

## สถานะ

**เฟส 1 จบวงแล้ว** — พิมพ์ในแผง → Claude เรียก tool ของ Cowork → ข้อมูลเปลี่ยนในฝั่งซ้าย

- [x] เปลือกสองฝั่ง + สะพาน v1 + ติดตามหน้าที่เปิดอยู่
- [x] OAuth PKCE loopback เข้า Cowork (ไม่ใช้ API key แล้ว)
- [x] ต่อ Claude Agent SDK — ไม่ส่ง credential, ขี่ login ของผู้ใช้
- [x] แนบบริบท "หน้าที่กำลังดู" ไปกับทุกคำถาม
- [x] ใช้ session ซ้ำ (resume) + โชว์ยอดค่าใช้จ่ายสะสม

ยังไม่มี (เรียงตามที่คุยกันไว้):
- [ ] **สตรีมทีละคำ** — ตอนนี้ข้อความมาทีเดียวจบ ระหว่างรอไม่เห็นอะไร
- [ ] **ปุ่มหยุด** — สั่งแล้วหยุดกลางคันไม่ได้
- [ ] **บทสนทนาหายเมื่อปิดแอป** — ยังไม่เก็บลงดิสก์
- [ ] ย้ายแผงไปเป็นหน้าใน cowork-app (ได้ระบบดีไซน์ + ไทย/อังกฤษ + รู้ว่าใครล็อกอิน)
- [ ] ซ่อนปุ่ม AI เดิมในเว็บเมื่ออยู่ในเปลือก
- [ ] skill 6 ตัวติดมากับแอป · โฟลเดอร์ `@` · local MCP · แจกจริง
