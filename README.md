# Automation & QA Developer – Assessment Submission

| Task | Files |
|---|---|
| 1. Web app QA & debug report | `task1/Task1_QA_Report_SumitGoyal.pdf` |
| 2. n8n API integration workflow | `task2/Task2_Workflow_SumitGoyal.json`, `task2/README.md`, `task2/screenshots/` |
| Bonus. Uptime monitor | `bonus/Bonus_UptimeMonitor_SumitGoyal.json`, `bonus/bonus_canvas.png`, `bonus/bonus_execution_app_up.png` |

**Loom walkthrough:** <link>

## Summary of work (under 1 page)
**Task 1:** The public RealWorld demo (demo.realworld.io) was down when tested (HTTP 404), so I ran the Conduit app locally. I tested sign-up, login, create, edit, delete and logout, then pushed edge cases: long inputs, special characters, XSS payloads, a throttled network, malformed API input and reuse of a token after logout. Most of this is automated in a Playwright script (`task1/qa-tests/qa.js`, 34 checks, with screenshots), and I confirmed each finding in the source code. I logged 14 issues. The most serious are dead external dependencies (no data and no styling), a session that survives logout, the app crashing on an empty article, and weak auth validation. The root-cause analysis covers the session surviving logout.

**Task 2:** This is an hourly "morning brief". It uses the GitHub Search API to find the top 5 new repos of the week, then a second GitHub call fetches the #1 repo's README. An IF node (stars > 1000) chooses the message style, and the digest goes to Discord. Each API node retries, then routes failures to a Discord alert. A failed README fetch degrades gracefully and doesn't stop the brief. An Error Trigger catches any uncaught crash. All secrets are kept in n8n Credentials.

**Bonus:** Every 5 minutes, the monitor checks the Task 1 app. It retries 3 times and measures response time. It alerts Discord when the app is down or slower than 3 s, and posts a daily summary at 9am with uptime %, average and slowest response.

## Run locally
```bash
docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n n8nio/n8n
```
Import each JSON (Workflows → Import from File), attach credentials, then activate.
