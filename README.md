# MediQ development starter

This repository contains the working Patient portal and Staff operations for MediQ, a web-based clinic queue management system. The active ML model estimates initial wait from anonymized F4 walk-in imaging records. A separate queue-activity calculation updates the displayed remaining wait. The F4 model has not been validated for MediQ clinics.

## Current milestone

- Administrator dashboard with staff account creation, activation and deactivation
- Administrator patient directory, clinic details, service capacity and special closure dates
- Staff IDs, clinic-issued temporary passwords and first-sign-in password changes
- Administrator clinic-service management with active-work protection
- Weekly operating hours and breaks linked to available appointment slots
- Combined, paginated Administrator and Staff activity log
- Working Node.js and Express application scaffold
- Responsive development-preview interface
- Homepage feature set based on the approved FYP prototype
- Clearly separated Patient, Staff and Administrator access with three sign-in pages
- Public patient registration only; Staff and Administrator accounts are clinic-issued
- Email verification for new Patient and Staff accounts, with a development link when SMTP is not configured
- Accessible live registration validation and strong-password guidance
- MySQL-backed patient registration, password hashing and secure role-aware sessions
- Protected Patient, Staff and Administrator dashboard entry
- MySQL-backed Patient dashboard, clinic-service selection and queue history
- Transactional daily queue-number generation with duplicate-active-queue prevention; displayed tickets include the service ID (for example, `Q2-001` and `Q3-001`) so separate service queues cannot appear to share a ticket
- Patient queue status with consistent remaining minutes and approximate consultation time across the overview and detailed status page
- Separate Staff overview, live queue, appointments, reports, and profile pages
- Staff report generation with queue metrics, ML prediction-versus-actual error, charts, CSV download, and a separately formatted PDF download
- Staff appointment search, status and date filters, and pagination
- Enforced queue ordering, validated status transitions, Patient notifications and Staff audit records
- Patient appointment requests, available-slot selection, status tracking and cancellation
- Appointment reminders for approved visits approaching within one day
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
- MySQL schema for users, services, queues, appointments, notifications and predictions
- FastAPI prediction service with the active F4 operational-data arrival-wait endpoint
- Chronological feature-selection/model comparison and saved F4 arrival-wait model, integrated at patient queue entry with the average-duration estimate as fallback
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
   For an existing MediQ database, run `npm run db:migrate:appointments` and `npm run db:migrate:admin` to add the newer tables and columns while preserving existing accounts and appointments.
4. Install dependencies and start the server:

```bash
npm install
npm run dev
```

5. Open `http://localhost:3000`. If that port is already occupied, set another one first, for example `$env:PORT=3100` in PowerShell.

To start the web application and ML service together, use `npm run dev:all`. It uses `ml-service/.venv` when available and otherwise tries the system Python. Press `Ctrl+C` to stop both services.

The public pages still load if MySQL has not been configured, but registration and sign-in will clearly report that account services are unavailable.

Staff and Administrator accounts are never publicly registered. Configure `SEED_STAFF_*` and `SEED_ADMIN_*` in `.env`; `npm run db:setup` creates or refreshes those controlled demonstration accounts using scrypt password hashes.

New Patient accounts and Administrator-created Staff accounts must verify their email before signing in. Set `APP_BASE_URL` and the `SMTP_*` values in `.env` to send verification messages. Without SMTP, the registration or Staff-creation response provides a development verification link; this link is not returned in production.

For local demonstration accounts, set `EMAIL_DELIVERY_MODE=preview` in `.env` and restart the web server. Register patients with distinct test-only addresses such as `patient1@example.test` and `patient2@example.test`. No email is sent: the registration page displays **Open local verification link**. Open that link once, then sign in with the password you chose. This setting works even if SMTP credentials are present, but is ignored when `NODE_ENV=production`. Use `EMAIL_DELIVERY_MODE=smtp` to test real delivery. A preview link tests MediQ's token-verification flow; it does not prove ownership of an email inbox. Existing unverified local accounts can request a fresh link through **Get a new verification link** on the sign-in page.

## Run the prediction service and prediction demos

From the project root, install the ML service dependencies and start the service:

```powershell
& .\ml-service\.venv\Scripts\python.exe -m pip install -r .\ml-service\requirements.txt
& .\ml-service\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir .\ml-service --reload --port 8000
```

API documentation will be available at `http://127.0.0.1:8000/docs`. The service exposes `GET /health` and the active `POST /predict-operational-wait` endpoint.

When the workbook is available locally, `POST /predict-operational-wait` predicts total wait at queue entry using the F4 walk-in model. Queue joining calls this endpoint through the Node service and stores the estimate and model version; if the ML service is unavailable, it falls back to people ahead multiplied by the service's average duration. The model was trained on the published [Medical Analytics Group Operational AI Challenge](https://medicalanalytics.group/operational-data-challenge/) workbook. The published analysis describes F4 `Wait` as arrival-to-exam-start time in minutes ([paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC7289434/)). This is an anonymized imaging workflow, not MediQ clinic data, so its offline score is not a claim of local accuracy. The F4 model estimates only at queue entry.

On active queue reads, MediQ separately recalculates an approximate remaining wait from the current number of active patients ahead. It uses the service's completed-patient throughput over the last 30 minutes when that rate is faster than the service average; otherwise it uses the average consultation duration as a baseline. When an earlier patient is in consultation, elapsed consultation time reduces the estimate, with a one-minute floor until that entry is completed. At the front of the queue, the patient sees the saved initial estimate count down; once its time passes, the display says staff will call when ready. Both patient pages use the same display logic and show one approximate clock time, not a fabricated five-minute interval. The live calculation is a transparent queue heuristic, not a trained or validated ML prediction.

The Staff live queue page refreshes every 20 seconds. It shows an approximate clock time and remaining minutes beside the estimate made at joining, highlights a front-of-queue patient when the estimate is reached, and keeps cancelled entries in a collapsible list. Staff still call patients when the clinician is ready; the next call button is disabled while another patient in the same service is called or in consultation. Staff Reports compares the saved F4 estimate with actual join-to-consultation wait for visits with a recorded consultation start, showing measured visit count, mean absolute error, and the number within five minutes. Fallback estimates are excluded from ML accuracy. Results from test visits should be interpreted as test data.

To retrain the F4 model, install the separate training dependencies and provide the workbook path. The script reads only the F4 sheet, uses `x_ArrivalDTTM` to order a chronological split, and does not use that anonymized timestamp as a predictor or to derive `Wait`:

```powershell
& .\ml-service\.venv\Scripts\python.exe -m pip install -r .\ml-service\requirements-training.txt
& .\ml-service\.venv\Scripts\python.exe .\ml-service\scripts\train_operational_wait_model.py --workbook "C:\path\to\WaitData.Published.xlsx"
```

The selected F4 model uses ElasticNet embedded feature selection followed by HistGradientBoosting. Its held-out chronological test MAE was 4.16 minutes (median baseline 5.21 minutes) on 7,803 later F4 records, with whole clinic days kept together across the splits. See `ml-service/reports/operational-wait-model/evaluation_report.md` for data-preparation, feature-selection and model comparisons, and `evaluation.json` for machine-readable results. These scores describe this test block only; they do not establish expected error for MediQ.

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
14. Close and reopen a service queue, then call the earliest waiting patient and move them into consultation. If another patient is waiting, use "Complete & call next" to finish the current consultation and call the next patient in one action.
15. Show the resulting Patient notification and explain that invalid transitions are rejected and Staff actions are audited.
16. Open Staff Appointments, search or filter by status and date, then approve a request or propose another time. Sign in as the patient to accept or decline the proposal.
17. Cancel a waiting queue entry as Staff and show its reason in Patient history.
18. Open Staff Reports, choose a date range, and inspect the ML prediction check once consultations have started. Download the separately formatted PDF or CSV. Open Staff Profile to update contact details or change the account password.
19. Start the FastAPI prediction service and show `/health` and `/docs`. Demonstrate queue joining to show the F4 arrival-time estimate being stored with its model version. Explain that this uses anonymized imaging data and is not validated for MediQ. Then show how the patient screen recalculates an approximate remaining wait when queue status changes.

## Next milestone

The F4 model provides a real-data training and system-integration demonstration, while the queue screen's live remaining estimate is a transparent throughput heuristic. The Staff report now measures joining predictions against consultation starts recorded in this database. For a MediQ-specific accuracy claim, collect representative clinic visits over time and evaluate on later dates; a few test or synthetic visits do not establish real-clinic accuracy.

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
