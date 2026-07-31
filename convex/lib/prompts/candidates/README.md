# Eco production prompt candidates

These candidates are intentionally not imported by the live Gemini path. They
are ready to paste into `ECO_SYSTEM_PROMPT` after evaluation and an explicit
production-selection decision.

## Size

Counts use whitespace-delimited words and Unicode characters inside the
template literal, after trimming. The supplied source prompt contains 1,819
literal words and 11,536 characters; `wc -w` reports 1,824 words for the whole
TypeScript attachment, including its export wrapper. The requested 1,824-word
reference is used for the acceptance percentages below.

| Candidate | Words | Characters | Word reduction | Character reduction |
| --- | ---: | ---: | ---: | ---: |
| Gemini 3.6 Flash | 798 | 5,428 | 56.3% | 52.9% |
| Gemini 3.5 Flash-Lite | 828 | 5,756 | 54.6% | 50.1% |

The Flash-Lite candidate differs only by adding a short route-selection gate
and a more explicit naming-outcome branch. Its product behavior is otherwise
the same as the 3.6 candidate.

## Behavior map

| Source behavior | Where it survives |
| --- | --- |
| Real partner, not a logger or support bot | Opening identity and **Voice and relationship** |
| Match pace and tone; avoid generic hype | **Voice and relationship** |
| Stay with relevant sleep, stress, work, mood, and life context | **Voice and relationship** |
| Discuss plans and injuries without pretending to save or diagnose | **Truth and safety** |
| Ground every claim and never invent a write or workout fact | **Truth and safety** |
| New-data-only logging with exact preservation | **New workout data and exercise names** / **Logging and naming rules** |
| Resolve every exercise ID before logging | Logging and naming section in both candidates |
| Search concrete unknown exercises without asking permission | Logging and naming section in both candidates |
| Do not store vague or descriptive aliases | Logging and naming section in both candidates |
| Ask conversationally for a generic exercise name without logging | Logging and naming section in both candidates |
| Use `needsClarification` only for a resolved, otherwise valid pending record | Logging and naming section in both candidates |
| Preserve multi-exercise grouping and one valid block type | Logging and naming section in both candidates |
| Follow active naming outcomes; create custom only after consent and safety checks | Logging and naming section in both candidates |
| Retrieve only absent, concrete data and batch general reads | Reads/data section in both candidates |
| Never fetch for greetings or open-ended conversation | Reads/data section and Flash-Lite route 1 |
| Use deterministic math for every checkable numeric answer | Calculations/maths section and Flash-Lite route 5 |
| Correct one exact card or historical block with a complete replacement | Corrections section and Flash-Lite route 3 |
| Describe historical corrections as awaiting confirmation | Corrections section in both candidates |
| Treat active cards as truth; only the user ends discussion | **Active cards and tool turns** |
| Use preferred units and labels rather than IDs | Logging, data, and active-card sections |
| Obey the five-follow-up countdown without exposing it | **Active cards and tool turns** |
| Be concise for logging but present in substantive or safety-sensitive conversation | Final instruction in both candidates |

The unavailable team-feedback behavior is intentionally removed. The
`{ reply: string }` envelope is intentionally left to the existing structured
response schema. Tool parameter shapes remain in the existing function
declarations instead of being duplicated here.

## Model configuration note

As of 31 July 2026, Google lists `gemini-3.6-flash` and
`gemini-3.5-flash-lite` as stable production models. Google also describes
3.5 Flash-Lite as having stronger multi-turn instruction following and persona
consistency than 3.1 Flash-Lite.

Evaluate the Flash-Lite candidate first at its default `minimal` thinking
level, then at `low`. Prefer the cheapest configuration that clears the hard
behavior gates before adding more prompt text. Do not set deprecated sampling
parameters.

- [Latest Gemini models](https://ai.google.dev/gemini-api/docs/latest-model)
- [Gemini thinking levels](https://ai.google.dev/gemini-api/docs/thinking)

The fixed comparison set and scoring rules are in
[`evaluation-set.md`](./evaluation-set.md).
