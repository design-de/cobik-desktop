---
name: cobik-status
description: >-
  Report the health and status of cobik work — a weekly readout, a project
  check-up, or a portfolio pulse. Use when the user asks "how are we doing",
  "status this week", "is this project on track", "what's at risk", "who's
  overloaded", or wants delivery / win-rate trends. Read-only: it produces a
  readout, not changes. Load together with `cobik-use`. To act on what you
  find, hand off to `cobik-triage` (fix the board) or `cobik-allocation`
  (rebalance people).
---

# cobik — รายงานสถานะ/สุขภาพ (readout)

ตอบคำถาม **"เราเป็นไงบ้าง"** ด้วยบทสรุปที่อ่านแล้วรู้เรื่อง — ไม่ใช่กองข้อมูลดิบ
โหลดคู่กับ **`cobik-use`** · skill นี้ **อ่านล้วน** (ไม่แก้อะไร)

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

## กฎเหล็กของ skill นี้
**อย่าดึง list ดิบมานับเอง** — cobik มี read เชิงวิเคราะห์ที่ดึงครั้งเดียวได้ภาพครบ ใช้พวกนี้ก่อนเสมอ

## เลือกขอบเขตก่อน
- **โปรเจกต์เดียว** → `project_deep_dive` (สุขภาพ, stage, งานที่ต้องสน, workload รายคน, ส่งตรงเวลา, งบ, activity — ครั้งเดียวจบ) · ใส่ `detail:"full"` เฉพาะตอนต้องการทุกแถวจริงๆ
- **ทั้งทีม/พอร์ต** → `portfolio_pulse` (progress/overdue/unassigned ทุกโปรเจกต์, workload ทีม, ใครล้น, เทรนด์ส่งงาน/อัตราชนะ)
- **เจาะเฉพาะเรื่อง** → `whats_overdue` (เลยกำหนด) · `estimate_accuracy` (วางแผน vs จริง) · `read_activity` (เกิดอะไรล่าสุด)

## เขียน readout ยังไง (ไม่ใช่เท data)
สรุปเป็น 3 ส่วนเสมอ:
1. **บนเส้นทาง** — คืบหน้าเท่าไร อะไรเสร็จ
2. **ต้องระวัง** — overdue / unassigned / คนล้น (เกิน ~70–80%) / เดดไลน์ใกล้
3. **ควรทำอะไรต่อ** — 1–3 ข้อ ชี้ชัด (เช่น "งาน X ไม่มีคนทำ 3 ชิ้น" → ชวนไป `cobik-triage`)

> ภาษา: ตัวเลข/ชื่อโปรเจกต์เป็นอังกฤษ คำอธิบายเป็นไทย

## ตัวอย่างสั้น
ผู้ใช้: "สรุปสถานะทีมสัปดาห์นี้"
1. `portfolio_pulse` (ครั้งเดียว)
2. อ่านค่า: 5 โปรเจกต์เดิน · 2 งาน overdue ที่ Project A · May โหลด 95% (ล้น)
3. readout: "ภาพรวมโอเค — เร่ง 2 งานเลยกำหนดที่ Project A, และ May งานล้น (95%) ควรเกลี่ย → ดู `cobik-allocation`"

> ถ้าจะ **ลงมือแก้** จาก readout: board ops ไป `cobik-triage` · เกลี่ยคน ไป `cobik-allocation` (skill นี้ไม่แก้เอง)
