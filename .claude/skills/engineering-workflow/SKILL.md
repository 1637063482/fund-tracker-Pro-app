---
name: engineering-workflow
description: End-to-end engineering discipline for coding, debugging, refactoring, and review. Merges Karpathy behavioral guidelines with Superpowers process rigor. Covers all phases: clarify requirements, plan granular steps, TDD implementation, systematic debugging, evidence-before-claims verification, and clean completion. Use when writing, fixing, refactoring, reviewing, or planning any non-trivial code change.
---

# Engineering Workflow — Complete Discipline

Merges the **behavioral layer** (how to think while coding) with the **process layer** (the workflow around coding). Every non-trivial task goes through 6 phases.

**Tradeoff:** This process is thorough. For single-line fixes, typos, or truly trivial changes, use judgment to skip phases. When in doubt, follow the process.

---

## Phase 0: CLARIFY — Understand Before Doing

**Do NOT write any code, scaffold any project, or take any implementation action until this phase is complete.**

### 0.1 Explore Context
- Read relevant files, docs, recent commits before proposing anything
- If the codebase is unfamiliar, spend at least 2 minutes reading before speaking

### 0.2 Surface Assumptions
- State your assumptions explicitly. If uncertain, ask — don't guess silently
- If multiple interpretations exist, present them all — don't pick one secretly

### 0.3 Ask Clarifying Questions
- Ask one question at a time, prefer multiple-choice format
- If something is unclear, stop. Name what's confusing. Ask.
- If a simpler approach exists, say so. Push back when warranted.

### 0.4 Propose Approach
- Present 2–3 approaches with tradeoffs and a recommendation
- No code yet — design discussion only
- Get approval before moving to Phase 1

**Gate:** Requirements are clear, approach is approved, no silent assumptions remain.

---

## Phase 1: PLAN — Design Before Code

**Output:** A written plan saved to `docs/superpowers/plans/` (or stated inline for small tasks).

### 1.1 Scope Check
- Does the spec cover a single subsystem? If multiple independent systems, split into separate plans
- Each plan covers one coherent change

### 1.2 Map File Structure
- List every file that will be created or modified, with clear responsibilities
- Use exact file paths

### 1.3 Granular Task Decomposition

Each task must be **2–5 minutes** and follow the TDD cycle:

```
Task N: [One action]
  1. Write failing test: [exact test file path and test name]
  2. Verify RED: npm test -- [test name] → expect FAIL
  3. Implement: [exact file, exact change]
  4. Verify GREEN: npm test -- [test name] → expect PASS
  5. Commit: git commit -m "[message]"
```

**Forbidden in plans:**
- ❌ "TBD", "TODO", "implement later", "add appropriate error handling"
- ❌ "Similar to Task N" without full details
- ❌ Any placeholder whatsoever

### 1.4 Self-Review Plan
Before presenting the plan, check:
- Does every step trace to the user's request?
- Are there placeholders, vague language, or untestable steps?
- Are file paths exact and commands complete with expected output?

**Gate:** Plan is written, reviewed, and approved by user before any code is written.

---

## Phase 2: BUILD — TDD + Simplicity + Surgical Precision

### 2.1 The Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**

If you wrote code before the test, delete it. Start over. No exceptions. Don't keep it as "reference." Don't adapt it. Delete means delete.

### 2.2 Red-Green-Refactor Cycle

#### RED — Write the Failing Test
- One minimal test showing what should happen
- One behavior per test, clear descriptive name
- Real code (no mocks unless unavoidable)

#### Verify RED — Watch It Fail (MANDATORY)
Run the test. Confirm:
- Test **fails** (not errors — if it errors, fix the error and re-run)
- Failure message is expected
- Fails because feature is missing, not because of typos

**Test passes?** You're testing existing behavior. Fix the test.
**Test errors?** Fix the error, re-run until it fails correctly.

#### GREEN — Minimal Code to Pass
- Write the simplest code to pass the test
- No features beyond what the test demands
- No refactoring other code
- No "improvements" beyond the test scope
- No error handling for impossible scenarios
- No abstractions for single-use code

**Ask yourself:** "Would a senior engineer say this is overcomplicated?" If yes, simplify.

#### Verify GREEN — Watch It Pass (MANDATORY)
- Run the test, confirm it passes
- Confirm other tests still pass
- Output must be pristine (no errors, warnings)

#### REFACTOR — Clean Up After Green Only
- Remove duplication, improve names, extract helpers
- Keep tests green throughout
- Do NOT add behavior during refactoring

### 2.3 Surgical Change Rules

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

**The test:** Every changed line should trace directly to the user's request.

### 2.4 Simplicity Checklist

Before calling any code done:
- [ ] No features beyond what was asked
- [ ] No abstractions built for hypothetical future needs
- [ ] No "configurability" or "flexibility" that wasn't requested
- [ ] If 200 lines could be 50, rewrite it
- [ ] Every function has a single clear purpose

**Gate:** All tests pass, output pristine, code is minimal, no adjacent code was touched.

---

## Phase 3: DEBUG — Systematic Root Cause

**Iron Law:** "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST." Symptom fixes are failure.

### 3.1 Phase 1 — Root Cause Investigation
1. **Read error messages thoroughly** — don't skim
2. **Reproduce consistently** — if you can't reproduce it, you can't fix it
3. **Check recent changes** — git diff, git log, dependency updates
4. **Add diagnostic instrumentation** — at every component boundary in multi-component systems, add logging/tracing BEFORE proposing any fix

### 3.2 Phase 2 — Pattern Analysis
1. Find **working examples** in the same codebase doing similar things
2. Compare against the broken code **completely** — don't skim, read every line
3. Identify **every difference** between working and broken

### 3.3 Phase 3 — Hypothesis and Testing
1. Form a **single specific hypothesis** for the root cause
2. Test with the **smallest possible change** (one variable at a time)
3. Verify before proceeding to next hypothesis
4. Say **"I don't understand X"** rather than pretending

### 3.4 Phase 4 — Implementation
1. Create a **failing test** that reproduces the bug (return to Phase 2 TDD)
2. Implement a **single fix** addressing the root cause
3. Verify the test passes
4. Verify no regressions

### 3.5 When to Stop and Reassess

**After 2 failed fix attempts:** Return to Phase 1 — you've likely missed the root cause.

**After 3 failed fix attempts:** Stop. Question the architecture. "3+ failures = wrong architecture, not a failed hypothesis."

**Red flags — stop immediately:**
- Thinking "quick fix for now, investigate later"
- Proposing fixes before tracing data flow end-to-end
- Attempting "one more fix" after 2+ failures
- Saying "should", "probably", or "looks right" without verification

**Gate:** Root cause is identified, reproduced in a failing test, fix addresses root cause not symptom.

---

## Phase 4: VERIFY — Evidence Before Claims

**Core Rule:** Never claim success without running a fresh verification command and reading its full output.

### 4.1 The 5-Step Gate

1. **Identify** the proof command (exact command, not a guess)
2. **Run** it fully — don't abort early
3. **Read** all output including exit code
4. **Confirm** output matches the claim (e.g., "34/34 pass", not "looks good")
5. **State** the claim only after confirmation

### 4.2 What Counts as Verification

| Claim | Required Evidence |
|-------|------------------|
| "Tests pass" | Full test output showing `N/N pass`, exit code 0 |
| "Build succeeds" | Full build output, exit code 0 |
| "Bug is fixed" | Test that reproduces bug FAILS before fix, PASSES after fix |
| "Performance improved" | Before/after measurements with same conditions |

### 4.3 Red Flags — Stop Immediately

Using words like: "should", "probably", "looks right", "seems fine", "appears to work."

Any wording implying success without having run the verification command. Evidence, not confidence.

### 4.4 Goal-Driven Loop

Transform vague requests into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state the plan with verification checkpoints:
```
1. [Step] → verify: [exact check]
2. [Step] → verify: [exact check]
3. [Step] → verify: [exact check]
```

Loop until every checkpoint passes. Weak criteria ("make it work") cause thrashing.

**Gate:** Verification has been run, output has been read, evidence confirms success.

---

## Phase 5: COMPLETE — Review, Clean, Deliver

### 5.1 Self-Review
- Scan for placeholders, TODO comments, dead debugging code
- Verify every changed line traces to the user's request
- Run the full test suite one final time — read the output
- Check for newly introduced warnings

### 5.2 Clean Up Your Own Mess
- Remove debugging instrumentation you added
- Remove imports your changes made unused
- Remove temporary files or test scaffolding
- Don't remove pre-existing dead code unless asked

### 5.3 Present Completion
State clearly what was done, what was verified, and what was NOT changed:
- "✅ Implemented X with Y tests"
- "✅ All N tests pass"
- "⚠️ Noticed unrelated issue Z in file A — not addressed"

### 5.4 Common Rationalizations — Recognize and Reject

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately proves nothing. |
| "Quick fix for now, investigate later" | "Later" never comes. Fix properly now. |
| "Already spent X hours" | Sunk cost fallacy. Start fresh if the approach is wrong. |
| "Tests after achieve the same goals" | Tests-after answer "What does this do?" Tests-first answer "What should this do?" |
| "Spirit of the rules is enough" | Violating the letter is violating the spirit. Follow the process. |

### 5.5 When to Skip Phases

This is a full process. Use judgment to compress it:

| Task size | Minimum phases |
|-----------|---------------|
| Typo / one-liner fix | Verify (Phase 4 only) |
| Small bug fix | Debug → Build(TDD) → Verify |
| New feature | Clarify → Plan → Build(TDD) → Verify → Complete |
| Refactoring | Clarify → Build(TDD) → Verify → Complete |
| Architecture change | All 6 phases, no exceptions |

**Bottom line:** This process is a tool, not a straightjacket. When the cost of the process exceeds the risk of skipping it, skip it consciously — never by accident.
