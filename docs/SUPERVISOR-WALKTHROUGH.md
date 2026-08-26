# MediQ supervisor walkthrough

## Current milestone

MediQ now has a working Node.js and Express foundation, a responsive homepage based on the approved FYP prototype, a clinic-services API, an initial MySQL schema and a separate Python prediction-service boundary.

## Homepage features represented

- Patient and Admin access selection
- Sign In and Register entry points
- Smart queue management
- Appointment booking
- Instant queue and appointment notifications
- Three-step journey: register, join or book, and receive updates
- Live loading of clinic services from the Express backend
- Sample queue status showing queue position and predicted waiting time

Authentication, real appointment submission, live notifications and queue joining are not yet connected to backend workflows. The interface labels or explains these as later milestones instead of presenting them as completed features.

## Working request flow

```text
Browser
  -> GET / and static frontend files
  -> frontend/app.js
  -> GET /api/health
  -> GET /api/services
  -> Express routes return JSON
  -> service cards are created in the browser
```

## Demonstration steps

1. Run `npm run dev`. If port 3000 is occupied, use `$env:PORT=3100` first.
2. Open the displayed localhost address.
3. Switch between Patient and Admin and explain that this prepares role-specific navigation.
4. Show the three prototype-derived feature cards.
5. Select the smart-queue link to move to the sample queue status.
6. Scroll to Available Consultations and explain that these cards are loaded from `/api/services`.
7. Open `/api/services` directly to show the JSON response.
8. Run `npm test` and show the homepage and API tests.

## Short explanation for the supervisor

> I have completed the initial MediQ homepage based on the features in my approved prototype while retaining a clean full-stack structure. The frontend is built with semantic HTML, responsive CSS and browser JavaScript. Node.js and Express serve the page and expose health, project-status and clinic-service APIs. The clinic-service cards are generated dynamically from an API response rather than being written directly into the page. Patient/Admin selection and the queue, appointment and notification areas establish the intended user journeys, while unfinished backend actions are clearly treated as development previews. I also prepared the MySQL schema and a separate FastAPI service for the future waiting-time model. My next milestone is database-backed services and user authentication.

## Next recommended milestone

1. Connect `/api/services` to MySQL.
2. Implement registration and login with hashed passwords.
3. Add patient/staff role-based access control.
4. Implement transactional queue joining.
5. Connect the Python waiting-time endpoint after baseline data collection.
