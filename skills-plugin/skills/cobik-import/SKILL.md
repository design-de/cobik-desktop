---
name: cobik-import
description: >-
  Build a cobik-ready `.xlsx` import file — for planning offline, or when NO
  cobik connector (MCP) is available. Use when the user asks for a file, has no
  live cobik tools, or wants to prepare tasks to upload and approve in the app's
  Import preview. Covers the exact import-file contract (columns, rules) so the
  file loads cleanly. If the cobik connector IS available, prefer working live —
  load `cobik-use` (and `cobik-plan` for planning from a brief) instead of
  making a file.
---

# cobik — import file (.xlsx)

skill นี้ = **สายไฟล์** ของ cobik: ช่วย AI สร้างไฟล์ `.xlsx` ที่อัปโหลดเข้าโปรเจกต์ได้ ผ่านหน้า preview ให้คนอนุมัติเสมอ (AI เสนอ — คนตัดสิน)
โครง cobik คือ **Project → Stage (ช่วงงาน) → Task (งาน) → Sub-task (งานย่อย — ในไฟล์ระบุด้วยคอลัมน์ `Parent`)** — บล็อกโมเดลเต็มอยู่ใน `reference/system-context.md`

## ⭐ ก่อนอื่น — มี connector ไหม (ถ้ามี นี่ไม่ใช่ skill ที่ควรใช้)

ถ้ามีเครื่องมือ cobik ให้เรียก (`list_projects`, `create_task`, `assign_task` …) แปลว่า **เชื่อม connector สดอยู่** — ทางสดดีกว่าไฟล์:

- ไปโหลด **`cobik-use`** (วิธีขับ connector ให้ถูก) และ **`cobik-plan`** (วางแผนจากบรีฟ) แล้วทำงานสดผ่าน tool
- **ห้าม**บอกผู้ใช้ว่า "cobik ไม่มี API" แล้วบังคับให้ทำไฟล์
- **ใช้ skill นี้ต่อเมื่อ:** ไม่มี connector · หรือผู้ใช้ขอเป็นไฟล์เอง (วางแผนออฟไลน์ / เก็บไว้ก่อน)

## กติกาทอง (อ่านก่อนเสมอ)

1. **คุณเสนอ — คนอนุมัติ** ทุกไฟล์ที่สร้างจะเข้าหน้า preview ในแอป ให้คนตรวจทุกแถวก่อนบันทึก คุณจะไม่ได้เขียนลงฐานข้อมูลตรงๆ
2. **ห้ามแต่ง ID** แถวที่มี ID = แก้งานเดิมนั้น · แถวที่ **ID ว่าง = สร้างงานใหม่** · ห้ามคิด ID ขึ้นเอง
3. **import ไม่เคยลบ** ลบแถวออกจากไฟล์ ≠ ลบงาน มันแค่ถูกปล่อยไว้เฉยๆ
4. **Stage สร้างจากไฟล์ไม่ได้** ต้องมีอยู่ในโปรเจกต์ก่อน — ใช้ชื่อให้ตรง (ดู [reference/tasks-contract.md](reference/tasks-contract.md))

## ใช้ skill นี้เมื่อ

- อยาก **สร้างไฟล์ .xlsx เพื่อ import** งานเข้าโปรเจกต์ (ไม่มี connector / ขอเป็นไฟล์)
- วางแผนงานแบบ **ออฟไลน์** เพื่อเก็บไว้อัปโหลดทีหลัง
- ถามเรื่อง **สัญญาไฟล์** import (คอลัมน์/กติกา) — สำหรับการวางแผนเชิงเนื้อหา (เฟส/บทบาท/ประเมินเวลา) ดู `cobik-plan`

## ขั้นตอนแนะนำ (สายไฟล์)

1. **ขอไฟล์ Export ก่อนถ้ามี** — ในแอปมีปุ่ม Export ได้ .xlsx ที่มี PROJECT_ID, รายชื่อ Stage ที่ใช้ได้, และรายชื่อทีม (อีเมล) การเริ่มจากไฟล์นี้ทำให้ Stage/คน/โปรเจกต์ตรงกันอัตโนมัติ แล้วคุณแค่ "เติม/แก้แถว"
2. **ถ้าไม่มีไฟล์** ก็สร้างใหม่จากศูนย์ได้ แต่ต้องรู้ชื่อ Stage และอีเมลทีมที่มีจริง (ถามผู้ใช้) เพราะชื่อที่ไม่ตรงจะถูกตีกลับในหน้า preview
3. อ่าน **[reference/tasks-contract.md](reference/tasks-contract.md)** ให้ครบ แล้วกรอกให้ตรงสัญญา
4. อ่าน **[reference/system-context.md](reference/system-context.md)** เพื่อวางแผนให้สมเหตุสมผล (เฟส pitch/work, บทบาท, การประเมินเวลา)
5. สร้างไฟล์ด้วย **[scripts/make_import_xlsx.py](scripts/make_import_xlsx.py)** (หรือเขียนโค้ดเองตามโครงในไฟล์สัญญา) แล้วส่งให้ผู้ใช้เอาไป import

## ชีตที่ import ได้มีแค่ "Tasks"

ไฟล์ Export มีหลายชีต (Project / Team / Milestones / Allocation / AI Guide) แต่ **ตอน import แอปอ่านแค่ชีต `Tasks`** ชีตอื่นเป็นข้อมูลอ้างอิงอย่างเดียว แก้ไปก็ไม่มีผล

## ตัวอย่างสั้น — เสนอแผน pitch

ผู้ใช้: "ช่วยร่างงานช่วง pitch โปรเจกต์เว็บ 2 สัปดาห์ให้หน่อย"

คุณสร้างแถวใหม่ (ID ว่างทั้งหมด, Phase = `pitch`, Status = `todo`) เช่น:

| Title | Status | Priority | Phase | Stage | Assignees (email) | Start | Due | Estimate (hrs) | ... | ID (ห้ามแก้) |
|---|---|---|---|---|---|---|---|---|---|---|
| Research คู่แข่ง | todo | med | pitch | Research | may@studio.co | 2026-07-14 | 2026-07-16 | 8 |  |  |
| ร่าง mood/direction | todo | high | pitch | Design | may@studio.co | 2026-07-17 | 2026-07-21 | 12 |  |  |
| ทำสไลด์ pitch | todo | high | pitch | Design |  | 2026-07-22 | 2026-07-25 | 16 |  |  |

แล้วบอกผู้ใช้ว่า "เปิดโปรเจกต์ใน cobik → ปุ่ม Import → อัปโหลดไฟล์ → ตรวจในหน้า preview แล้วกดยืนยัน"

> **ต้นฉบับของสัญญานี้อยู่ในตัวแอป** (`cobik-app/lib/taskImportContract.mjs`) และ [reference/tasks-contract.md](reference/tasks-contract.md) ถูก generate จากที่นั่น — ห้ามแก้ด้วยมือ ดูวันที่ generate ท้ายหัวไฟล์สัญญา
