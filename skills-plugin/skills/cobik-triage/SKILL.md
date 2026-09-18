---
name: cobik-triage
description: >-
  Maintain an existing cobik board and respond to change — bulk status updates,
  renames, shifting dates when a deadline moves, reassigning a departing person's
  work, reordering or merging stages, and restoring deleted items from trash. Use
  when the user says "the deadline moved, shift everything", "rename all X to Y",
  "reassign someone's tasks", "clean up the board", "merge these stages", or
  "restore that deleted task". Load together with `cobik-use`. For planning a NEW
  project from scratch use `cobik-plan`; for capacity rebalancing use
  `cobik-allocation`.
---

# cobik — ดูแลบอร์ดเดิม/รับมือความเปลี่ยนแปลง (playbook)

บอร์ดมีอยู่แล้ว แล้ว **มีอะไรเปลี่ยน** — เดดไลน์เลื่อน คนออก ชื่อผิด สเตจรก
skill นี้ = ปรับของเดิมเป็นชุดให้เร็วและปลอดภัย · โหลดคู่กับ **`cobik-use`**

<!-- MODEL:START · generate จาก cobik-app/lib/modelContext.js (รัน node scripts/gen-skill-context.mjs) — ห้ามแก้มือระหว่าง marker -->
```
Client (ลูกค้า) → Project → Stage (ช่วงงาน) → Task (งาน) → Sub-task (งานย่อย — ชั้นเดียว ติ๊กแยกได้ มีคน/วัน/ชั่วโมงของตัวเองได้)
```

- **Client** = ลูกค้า จัดกลุ่มโปรเจกต์ (ลูกค้า 1 ราย มีได้หลายโปรเจกต์ · โปรเจกต์สังกัดลูกค้าได้ 1 รายหรือไม่มีก็ได้) — ใช้ดูงบรวม/อัตราชนะต่อลูกค้า · การ import ทาง .xlsx ยังไม่แตะ client (ตั้งลูกค้าในแอป)
- **Project** = โปรเจกต์หนึ่งงานของทีม มีเจ้าของ (owner), งบ, ช่วงวันของ pitch และของ work
- **Stage** = "ช่วงงาน" ที่ใช้จัดกลุ่ม task เช่น Research / Design / Production · แต่ละ stage สังกัด **เฟลเดียว** (pitch หรือ work)
- **Task** = งานหนึ่งชิ้น มีสถานะ/ความสำคัญ/ผู้รับผิดชอบ/ช่วงเวลา/ชั่วโมง · ทุกงานมี **เลขงานสั้น `KEY-123`** (ตัวย่อโปรเจกต์ + เลขรันของโปรเจกต์นั้น เช่น `CO-142`) — ใช้แทน id ได้ทุกที่ที่รับ task id และเป็นเลขที่ผู้ใช้เห็นในแอป · `id` (uuid) ยังเป็นตัวจริงของระบบ
- **Sub-task (งานย่อย)** = task ที่มี `parent_task_id` ชี้งานแม่ — ลึกได้ **ชั้นเดียว** (งานย่อยมีลูกอีกไม่ได้) · สืบทอด project/stage/phase จากแม่เสมอ (**ย้ายงานย่อยข้ามช่วงงาน/เปลี่ยนเฟสตรง ๆ ไม่ได้ — ย้ายที่งานแม่ แล้วลูกตามไปทั้งชุด**) · มีสถานะ/คน/วัน/ชั่วโมงของตัวเองได้ (ไม่บังคับ) · ใช้เมื่อขั้นย่อยต้องติ๊กแยก มีคนรับผิดชอบหรือชั่วโมงของตัวเอง · ชั่วโมงของแม่กับลูกนับแยกกัน (แอปแสดงยอดรวมให้) · ลบแม่ = ลูกไปถังขยะด้วยและกู้กลับพร้อมกัน · ใน .xlsx ระบุด้วยคอลัมน์ Parent (ชื่องานแม่)
<!-- MODEL:END -->

## กฎเหล็ก 2 ข้อ
1. **กรองให้ตรงชุดก่อนเสมอ** — อย่ากวาดทั้งโปรเจกต์มั่ว · ใช้ filter (stage/phase/assignee/ข้อความ) ให้เหลือเฉพาะที่จะแก้
2. **ของที่ดูรุนแรง สรุปก่อนกด** — เลื่อนวันทั้งโปรเจกต์ / ย้ายงานยกทีม / merge stage = บอกจำนวนที่กระทบก่อนยิงจริง

## เครื่องมือตามสถานการณ์
| เกิดอะไร | ใช้ |
|---|---|
| เดดไลน์เลื่อน ขยับงานเป็นชุด | `shift_dates` (ตามกฎ เช่น +7 วัน) |
| เปลี่ยนสถานะหลายงานทีเดียว | `update_tasks` |
| ชื่อผิด/เปลี่ยนคำเป็นชุด | `rename_tasks` (find→replace) |
| คนออก โยนงานต่อ | `reassign_work` (ดู `cobik-allocation` ถ้าต้องเลือกคนรับ) |
| จัดลำดับ/รวมสเตจ | `reorder_stages` · `merge_stage` |
| เผลอลบ อยากได้คืน | `list_trash` → `restore_task` / `restore_stage` (คืนพร้อม id เดิม) |

## ตัวอย่างสั้น
ผู้ใช้: "เดดไลน์ Project A เลื่อนไป 1 สัปดาห์"
1. กรองงานที่ยังไม่ done ของ Project A (เฟส work)
2. สรุป: "จะเลื่อน Start/Due 12 งาน +7 วัน — โอเคไหม"
3. ตกลง → `shift_dates` (+7d, เฉพาะชุดที่กรอง)

> ไม่มีอะไรหายถาวร — ลบแล้วกู้จาก trash ได้ · การกระทำทุกอย่างถูกบันทึกใน activity log (อยู่ใน `cobik-use`)
