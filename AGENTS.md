# AGENTS.md — Price Worker Rules

## Responsibility

This service is responsible ONLY for:
- fetching prices from Steam
- updating Pricing collection
- managing pricing sync jobs

## Critical Rules

❌ DO NOT:
- Add ranking logic here
- Call frontend directly
- Duplicate backend logic

✅ ALWAYS:
- Update prices in MongoDB
- Respect rate limits
- Handle 429 properly
- Resume jobs correctly

## Sync Behavior

- Only one sync job should run at a time
- On 429 → pause job and set resumeAfter
- Resume should continue from last checkpoint

## Backend Communication

- After successful completion → notify backend
- Use internal API
- Do not block worker on backend response

## Code Style

- Keep runner logic clear and sequential
- Avoid deeply nested logic
- Log important events
