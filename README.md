# MediQ development starter

This repository contains the working Patient portal and first Staff operations milestone for MediQ, a web-based clinic queue management system. Patient workflows, Staff queue control and Staff appointment management are implemented. The Administrator portal now manages staff accounts, services and weekly appointment hours. Trained machine-learning predictions remain a later milestone.

## Current milestone

- Administrator dashboard with staff account creation, activation and deactivation
- Administrator clinic-service management with active-work protection
- Weekly operating hours and breaks linked to available appointment slots
- Combined, paginated Administrator and Staff activity log
- Working Node.js and Express application scaffold
- Responsive development-preview interface
- Homepage feature set based on the approved FYP prototype
- Clearly separated Patient, Staff and Administrator access with three sign-in pages
- Public patient registration only; Staff and Administrator accounts are clinic-issued
- Accessible live registration validation and strong-password guidance
- MySQL-backed patient registration, password hashing and secure role-aware sessions
- One-time email verification for new Patient and Staff accounts, with 24-hour links
- Automatically generated Staff temporary passwords, displayed once to the Administrator and replaced after first sign-in
- Protected Patient, Staff and Administrator dashboard entry
- MySQL-backed Patient dashboard, clinic-service selection and queue history
- Transactional daily queue-number generation with duplicate-active-queue prevention
- Patient queue status, transparent baseline waiting estimate and cancellation reason
- Staff operations overview and live service queue management
- Enforced queue ordering, validated status transitions, Patient notifications and Staff audit records
- Patient appointment requests, available-slot selection, status tracking and cancellation
- Staff appointment approval, rejection, completion and proposed rescheduling
- Patient acceptance or decline of proposed times with notifications and staff audit records
- Clinic-wide slot conflict prevention, including simultaneous booking requests
- Staff queue cancellation with a required reason and a terminal cancelled status
- Patient notification inbox with read/unread state
- Filterable queue history, profile editing and secure password changes
- Draft Terms and Conditions and Privacy Notice for supervisor review
- Dedicated, responsive pages for all Patient portal features
- Three-step patient journey section
- Clinic services loaded dynamically from the Express API
- Health and project-status API endpoints
- Configurable MySQL connection
- Automatic patient and Staff queue refresh while the relevant page is visible
- Date-specific clinic closures that remove appointment availability
- ML-ready prediction snapshots with queue context and actual waiting-time outcomes
- Staff temporary-password replacement and secure password changes
- Administrator patient search with queue and appointment history
- In-system reminders for approved appointments occurring today or tomorrow
- Optional daily queue capacity for each clinic service
- Staff appointment search, date filters and pagination
- Configurable clinic name, address, contact number and timezone
- MySQL schema for users, services, queues, appointments, notifications and predictions
- Small FastAPI prediction-service stub with a clearly labelled baseline calculation
- Automated tests for public pages, authentication, ownership and Patient workflows

## Project structure

```text
backend/       Node.js and Express application
frontend/      HTML, CSS and browser-side JavaScript
database/      Initial MySQL schema
ml-service/    Python/FastAPI prediction-service boundary
```

## Run the web application

1. Install Node.js and MySQL.
2. Copy `.env.example` to `.env` and update the database settings.
3. Run `database/schema.sql` and then `database/admin-schema.sql` using MySQL Workbench.
   Alternatively, add your database credentials and controlled demo accounts to `.env`, then run `npm run db:setup`.
4. Install dependencies and start the server:

```bash
npm install
npm run dev
```

5. Open `http://localhost:3000`. If that port is already occupied, set another one first, for example `$env:PORT=3100` in PowerShell.

The public pages still load if MySQL has not been configured, but registration and sign-in will clearly report that account services are unavailable.

Staff and Administrator accounts are never publicly registered. Configure `SEED_STAFF_*` and `SEED_ADMIN_*` in `.env`; `npm run db:setup` creates or refreshes those controlled demonstration accounts using scrypt password hashes.

To send real verification emails, configure `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in `.env`, then restart the server. When SMTP is left blank during local development, the registration result displays a development verification link so the workflow can still be tested. Newly registered Patients and newly created Staff cannot sign in until they use the link. Existing accounts are marked as verified when the migration first adds this feature.

## Run the prediction-service stub

Open `ml-service` in PyCharm, create a virtual environment, and run:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API documentation will be available at `http://127.0.0.1:8000/docs`.

## Suggested supervisor demonstration

1. Show the folder structure and explain the client-server separation.
2. Start the Node.js server and demonstrate the completed homepage sections.
3. Visit `http://localhost:3000/api/project-status` to show the first backend endpoint.
4. Open `database/schema.sql` and explain the user, queue, appointment and notification relationships.
5. Demonstrate that the clinic-service cards are loaded through `/api/services`.
6. Demonstrate invalid and valid registration values, the live password checklist, password visibility and confirmation matching.
7. Switch among Patient, Staff and Administrator on the homepage and show the separate restricted sign-in pages.
8. Open the Terms and Privacy page and point out the items that the clinic must confirm before deployment.
9. Register a patient, sign in, select a service and join the queue. Show the queue number, position and baseline estimate.
10. Cancel the queue with a reason and show that it remains in the filterable queue history.
11. Request an appointment and show its pending clinic-approval status, then open the notification inbox.
12. Update the Patient profile and demonstrate the password requirements, matching feedback and show/hide controls.
13. Sign in as Staff and show today’s operational totals and service queues.
14. Close and reopen a service queue, then call the earliest waiting patient and move them into consultation.
15. Show the resulting Patient notification and explain that invalid transitions are rejected and Staff actions are audited.
16. Open Staff Appointments, approve a request, or propose another date and time. Sign in as the patient to accept or decline the proposal.
17. Cancel a waiting queue entry as Staff and show its reason in Patient history.
18. Explain that the current waiting time is a transparent baseline and will later be replaced by a trained and evaluated regression model.

## Next milestone

The next development milestone is dataset preparation and a trained, evaluated waiting-time model. The application now records ML-ready queue context and actual waiting-time outcomes, supports operational reporting, handles special closure dates and automatically refreshes active queue views.

## Appointment rules and database upgrade

- One pending, approved or proposed appointment reserves a date-and-time slot across the whole clinic. Different times on the same date remain available.
- The existing limit of one active appointment per patient per day is retained.
- All appointment writes acquire the same MySQL row lock before checking conflicts. Competing requests are serialized, including rescheduling and cancellation.
- Rescheduling releases the original slot and reserves the proposed slot. Patients must accept to confirm; declining cancels the appointment and releases the slot. A stale proposal cannot be accepted.
- Staff must provide reasons for rejection, rescheduling and queue cancellation. Cancelled queue entries cannot be recalled. Older skipped entries remain historical records.
- Patient registration and profile edits take effect without administrator approval; appointment approval is a separate Staff workflow.
- Appointment times use Malaysia time. Available 30-minute slots follow the Administrator weekly schedule. Initial hours retain the previous prototype (daily 09:00–17:00, break 12:00–14:00) until reviewed.

For an existing database, run the non-seeding upgrade once before restarting the app:

```bash
npm run db:migrate:appointments
npm run db:migrate:admin
```

This preserves existing appointments and credentials and reports pre-existing duplicate slots without deleting them. Fresh installs can continue using `npm run db:setup`.

Run `npm test` for automated API and validation tests. To explicitly verify the complete appointment workflow and concurrent bookings against the configured MySQL database, run:

```bash
node backend/tests/appointmentDatabaseCheck.js
```

The database check creates temporary users, sessions and appointments and removes its own records afterward. It requires the reserved test dates (30–31 December 2099) to be unused. It does not start the normal application server.


## Administrator demonstration

1. Start or restart the app and sign in through Administrator sign in. It opens `/admin-dashboard.html`.
2. Create a Staff account, sign in as that staff member in another browser, then deactivate the account. Existing sessions lose access and further sign-ins are blocked. Reactivation requires a new sign-in.
3. Add or edit a clinic service. The public homepage and patient service options use the saved database values. A service with active queues or upcoming bookings cannot be deactivated.
4. Review Operating hours. Set weekly opening, closing and optional break times, or close a weekday. Times use half-hour boundaries. These hours govern appointment availability; walk-in queues remain under Staff open/close control.
5. Save the hours, then check a matching date in Patient Appointments. Closed days and break times have no bookable slots. Schedule changes that invalidate existing appointments are blocked, and a stale administrator edit requires reloading the schedule.
6. Open Activity log to review account, service, schedule, queue and appointment actions. Patient registrations and profile changes still do not require approval.

The Administrator portal has no public account creation and no ability to promote staff into administrators. Staff passwords are hashed and omitted from account lists and audit records. Deactivation preserves visit and audit history.

To run the Administrator integration check against a disposable database:

```bash
node backend/tests/adminDatabaseCheck.js
```

This requires MySQL permission to create a test database. The check removes its generated database afterward and does not alter the configured application's records. It exercises staff access, session revocation, services, hours, appointment availability and audit persistence.
