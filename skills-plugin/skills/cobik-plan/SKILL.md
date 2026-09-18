---
name: cobik-plan
description: >-
  Plan or simulate a cobik project, pitch, or phase end-to-end — turn a brief
  into stages, sequenced tasks, realistic estimates, and assignments. Use when
  the user says things like "plan a 3-week pitch", "draft the tasks for this
  project", "break this brief into work", or "set up a new phase". Load together
  with `cobik-use` (the connector fundamentals). Works live through the
  connector by default; if no connector is available or the user wants a file,
  hand off to `cobik-import`.
---

# cobik — วางแผนจากบรีฟ (playbook)

เปลี่ยน **บรีฟ → โครงงานที่ลงมือได้จริง** (stage → task → ประเมิน → มอบหมาย) บน cobik
โหลดคู่กับ **`cobik-use`** เสมอ (กติกาการขับ connector อยู่ที่นั่น) — ตัวนี้คือ "สูตรวางแผน" ที่ต่อยอด

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

## สด หรือ ไฟล์
- **มี connector →** ทำสดตามสูตรนี้ (สร้าง stage/task ผ่าน tool) — ค่าเริ่มต้น
- **ไม่มี connector / ผู้ใช้ขอไฟล์ →** ใช้สูตรเดียวกันคิดแผน แต่ไปออกเป็น `.xlsx` ตาม **`cobik-import`**

## 2 เฟสของโปรเจกต์ (ต้องรู้ก่อนวาง)
- **pitch** = ช่วงเสนอ/ประมูล (วิจัย ร่างไอเดีย ทำสไลด์) — ยังไม่ใช่งานผลิต
- **work** = ช่วงผลิตจริงหลังได้งาน
- ทุก stage และทุก task สังกัดเฟสเดียว → ตั้ง `phase` ให้ตรงงาน

## สูตรวางแผน (ทำตามลำดับ)

**1. รู้บริบทก่อน อย่าเดา**
- `list_projects` → เลือกโปรเจกต์ + `project_id` · โปรเจกต์ไหน เฟสไหน (pitch/work)
- `list_project_directory` → ทีมมีใคร + **อีเมลจริง** (ต้องใช้ตอนมอบหมาย)
- `list_project_tasks` → มี stage/งานอะไรอยู่แล้ว จะได้ไม่ซ้ำ
- `who_is_free` / `capacity_report` → ใครพอมีเวลารับงาน

**2. ออกแบบโครง (stages)**
- จัดกลุ่มงานเป็นช่วงตามลำดับจริง: Research → Design → Production
- มี template ที่เข้ากัน → `apply_stage_template` · ไม่มี → `create_stage` (ตั้งชื่อ **อังกฤษ**, ผูกเฟสให้ถูก)

**3. แตกงาน (tasks) — ใช้ bulk**
- `create_tasks` สร้างทีเดียวทั้งชุด ใต้ stage + phase ที่ถูก
- แต่ละงาน: `status=todo` · ประเมิน `estimate_hours` **ตามจริง** (อย่าใส่มั่ว) · ปล่อย actual ว่าง
- ชื่องาน=อังกฤษ, คำอธิบาย=ไทย (ภาษาลูกผสมของทีม)
- เรียง Start/Due ไม่ให้คนเดียวมีงานทับซ้อนเกินจริง (แอปจะขึ้น over-allocation)

**4. มอบหมาย**
- `assign_tasks` (bulk) ตาม `who_is_free`/`capacity_report` · เลี่ยงกองคนเดียว (เพดาน ~70–80%)
- **ห้ามเดาอีเมล** — ไม่ชัดก็เว้นว่างไว้ แล้วบอกผู้ใช้

**5. เสนอเป็นร่างก่อนลงมือชุดใหญ่**
- สรุปโครงให้ผู้ใช้เห็นก่อน (กี่ stage, กี่งาน, ใครทำ, รวมกี่ชั่วโมง) แล้วค่อยยิง bulk create/assign

## ตัวอย่างสั้น
ผู้ใช้: "วางแผนช่วง pitch เว็บ 2 สัปดาห์ ทีม 2 คน"
1. `list_projects` + `list_project_directory` → ได้ project_id + อีเมลทีม (may@…, ken@…)
2. `create_stage` (phase=pitch): **Research**, **Design**
3. `create_tasks` (phase=pitch, todo):
   - *Competitor research* → Research · may · 8h
   - *Mood & direction* → Design · may · 12h
   - *Pitch deck* → Design · ken · 16h
4. `assign_tasks` ตามข้างบน · เช็ค `who_is_free` ว่าช่วงนั้นว่างจริง
5. สรุปให้ผู้ใช้: "3 งาน · 36h · may 20h / ken 16h — ตกลงไหมก่อนสร้างจริง"

> ถ้ายังไม่มี connector: คิดแผนเดียวกันนี้แล้วไปออกเป็นไฟล์ตาม `cobik-import` (ทุกแถว ID ว่าง = งานใหม่)
