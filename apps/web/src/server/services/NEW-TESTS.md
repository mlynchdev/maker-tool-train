# New Tests Added

26 tests added across 5 files, bringing the total from 21 to 47.

## Test Inventory

| Rank | File | Test Name | What It Validates | Category |
|------|------|-----------|-------------------|----------|
| 1 | `training.test.ts` | rejects progress delta exceeding 2.5x session duration | Anti-cheat: blocks inflated watch progress claims | Security |
| 2 | `training.test.ts` | rejects when watched seconds exceed video duration | Anti-cheat: blocks impossible watch totals | Security |
| 3 | `training.test.ts` | rejects session duration exceeding 300 seconds | Anti-cheat: blocks unreasonably long session claims | Security |
| 4 | `eligibility.test.ts` | returns eligible when all training is done and checkout exists | Happy path for the core authorization gate | Core logic |
| 5 | `booking-workflow.test.ts` | approves a pending reservation when there are no conflicts | Happy path for the primary admin action | Core logic |
| 6 | `eligibility.test.ts` | returns early when user is not found | Guards against deleted/invalid user IDs | Error handling |
| 7 | `eligibility.test.ts` | returns early when machine is not found | Guards against deleted/invalid machine IDs | Error handling |
| 8 | `eligibility.test.ts` | rejects inactive users | Suspended users cannot pass eligibility | Access control |
| 9 | `eligibility.test.ts` | treats training at exactly the threshold as completed | Boundary: 90 of 90 required = pass, not fail | Boundary |
| 10 | `booking-workflow.test.ts` | rejects booking when there is a time conflict | Prevents double-booking the same machine/time | Core logic |
| 11 | `booking-workflow.test.ts` | returns a validation error when end time is before start time | Catches the other invalid date range branch | Input validation |
| 12 | `booking-workflow.test.ts` | returns not found when moderating a nonexistent reservation | Guards moderation against stale/bad IDs | Error handling |
| 13 | `events.test.ts` | does not break other subscribers when one throws | Error isolation: one bad callback can't kill the bus | Resilience |
| 14 | `events.test.ts` | targets a specific user with publishToUser | User-scoped events reach only the intended user | Core logic |
| 15 | `events.test.ts` | broadcasts to all user channels | System-wide events reach every connected user | Core logic |
| 16 | `events.test.ts` | delivers published events to subscribers | Basic pub/sub contract works | Core logic |
| 17 | `events.test.ts` | stops delivering events after unsubscribe | Cleanup: no leaked callbacks after disconnect | Correctness |
| 18 | `checkout-scheduling.test.ts` | deactivates an existing availability rule | Managers can remove their availability blocks | Core logic |
| 19 | `checkout-scheduling.test.ts` | returns not found when deactivating a nonexistent rule | Guards deactivation against bad IDs | Error handling |
| 20 | `checkout-scheduling.test.ts` | rejects availability block with invalid day of week | Catches out-of-range day values (e.g. 7) | Input validation |
| 21 | `checkout-scheduling.test.ts` | rejects availability block with end time before start time | Catches reversed minute ranges | Input validation |
| 22 | `training.test.ts` | allows progress delta within 2.5x session duration | Valid progress is accepted (anti-cheat doesn't over-reject) | Core logic |
| 23 | `training.test.ts` | allows updates that do not claim new progress | Position-only updates pass without rate checks | Core logic |
| 24 | `training.test.ts` | allows session duration of exactly 300 seconds | Boundary: max allowed session is accepted | Boundary |
| 25 | `training.test.ts` | allows progress delta at exactly the 2.5x limit | Boundary: delta of exactly 75s with 30s session passes | Boundary |
| 26 | *all 3 existing files* | removed redundant `vi.clearAllMocks()` | Cleanup: vitest config already sets `clearMocks: true` | Maintenance |

## Ranking Rationale

- **Ranks 1-3**: Anti-cheat validation in `validateProgressUpdate()` — pure functions with zero mocking, high business value, and previously completely untested.
- **Ranks 4-5**: Happy-path tests for the two most important workflows (eligibility and booking approval) that had no positive-outcome coverage.
- **Ranks 6-12**: Error handling and boundary cases in the existing eligibility/booking services that close real gaps.
- **Ranks 13-17**: EventBus tests — standalone class with no dependencies, easy to verify, and the error-isolation test (rank 13) catches a real resilience concern.
- **Ranks 18-25**: Checkout scheduling and training edge cases that round out coverage.
