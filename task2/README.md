# Task 2 – GitHub Trending "Morning Brief" (n8n)

## What it does
Every hour (or on `GET /webhook/morning-brief`), the workflow finds the most-starred GitHub repos created in the last 7 days, enriches the #1 repo with its README, and posts a digest to Discord.

```
Schedule / Webhook / Manual → GitHub Search → Code (Top 5) → GitHub README → Code (Build Digest)
  → IF stars > 1000 → "🔥 HOT" message / else "🌱 Quiet" message → Discord
Error outputs (Search, README, Discord) → Build Error Alert → Discord
Error Trigger (uncaught crashes) → Format Crash Alert → Discord
```

## APIs and why
- **GitHub REST API**: `/search/repositories` and `/repos/{owner}/{repo}/readme`. It's free, well documented, returns rich JSON, and has a natural second endpoint for enrichment. It's also relevant for a dev team's morning brief.
- **Discord webhook**: free and needs no bot setup. It's instant to test.

## Transformation
The `Top 5 Repos` Code node sorts by `stargazers_count`, keeps 5 repos, and reduces each one to name, URL, stars, language and a trimmed description. If GitHub returns nothing, it throws an error. `Build Digest` base64-decodes the README, strips HTML and images, keeps a 300-character snippet, and builds the markdown list. Messages are capped at 1,990 characters because Discord's limit is 2,000.

**Threshold:** a new repo that passes 1,000 stars in under a week is unusual, so it gets flagged as "HOT".

## Error handling
| Failure | Behaviour |
|---|---|
| GitHub search fails (rate limit, 5xx, timeout) | 3 retries 2 s apart. Then the error output goes to a Discord alert naming the node and the error. |
| README fetch fails | 2 retries. Then the digest **still sends** with "README unavailable". Enrichment is optional, so it degrades gracefully. |
| Discord post fails | 3 retries. Then the error goes to the alert branch. |
| Anything uncaught (e.g. a code exception) | The Error Trigger sends a crash alert with the execution link. Settings → Error Workflow points to this workflow. |

Every error is also written with `console.log` to the n8n logs.

## Credentials (no hard-coded secrets)
- **GitHub**: a *Header Auth* credential, `Authorization: Bearer <PAT>`. This raises the rate limit from 60 to 5,000 requests an hour.
- **Discord**: a *Discord Webhook* credential that holds the webhook URL.

## Test
```bash
curl http://localhost:5678/webhook/morning-brief
```
To test the error path, change the search URL to `https://api.github.com/search/repositoriesXX` and run again. A ⚠️ alert should arrive in Discord.
