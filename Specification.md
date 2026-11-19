# Sensewell

## Product Specification — Planning Baseline

**Status:** Discussion draft; product assumptions and scope require validation  
**Date:** November 18, 2026  
**Purpose:** Establish a shared understanding of the product and guide a planning session. This document describes **what Sensewell should accomplish, for whom, and why**. It deliberately does not prescribe architecture, technology, APIs, data schemas, engineering processes, or implementation plans.

---

# 1. Product Vision

**Sensewell is an AI-powered operational observability platform that transforms industrial camera footage into meaningful operational events, insights, and evidence-backed investigations.**

The conceptual analogy is software observability: where tools such as Sentry help teams identify, understand, and investigate application behavior, Sensewell aims to help organizations understand physical operations. Cameras provide observational input; **operational conditions, events, measurements, trends, and investigations** provide customer value.

Sensewell should help customers:

- Understand what happened, where, and when, without reviewing hours of footage manually.
- Define the operational conditions that matter to their processes.
- Capture occurrences of those conditions for analysis, whether or not anyone needs an immediate notification.
- Notify responsible people or connected systems when explicitly configured to do so.
- Identify recurring delays, bottlenecks, unusual patterns, and changes in performance.
- Investigate conclusions through supporting video evidence, with clear indication of uncertainty or missing coverage.
- Assess whether operational changes lead to measurable improvements.

**Positioning hypothesis:** Sensewell is an operational intelligence product, not a live video platform, general-purpose CCTV system, or industrial safety product.

# 2. Problems and Opportunities

Industrial operations often contain valuable signals that are visible to cameras but not consistently captured as usable information. Video may exist, yet understanding operational performance can still depend on manual observation, anecdotes, isolated investigations, or reviewing long recordings.

Potential customer problems include:

- No reliable history of how often an operational condition occurs.
- Difficulty measuring delays, dwell times, occupancy, or process variation.
- Limited visibility into recurring issues across shifts, zones, or facilities.
- Time-consuming investigations that require manual footage review.
- Inconsistent escalation of conditions that warrant operational attention.
- Difficulty validating whether a process improvement changed outcomes.

# 3. Customers and Users

Potential users and their jobs to be done:

| User | What they need to accomplish |
|---|---|
| Operations managers | Understand recurring operational problems, compare periods, and prioritize improvements. |
| Continuous-improvement teams and process engineers | Define meaningful measurements, study bottlenecks, and assess process changes. |
| Shift supervisors and facility operators | Recognize relevant operational conditions, respond to non-safety-critical notifications, and inspect context. |
| Analysts and investigators | Examine event histories, investigate specific periods, and verify findings against footage. |
| Administrators and integrators | Manage authorized access, camera availability, organizational configuration, retention, and permitted integrations. |

# 4. Core Product Model

The product should maintain a clear conceptual distinction among five elements.

| Concept | Meaning | Example |
|---|---|---|
| **Observation** | What the system appears to perceive from footage, with associated confidence and limitations. | A forklift is detected in a camera's field of view. |
| **Rule** | A customer-defined condition of operational interest. | A forklift remains in Zone A for at least five minutes. |
| **Operational event** | A recorded occurrence of a rule condition, with time and supporting evidence. | The dwell-time threshold was reached at 14:05. |
| **Action** | An optional, explicitly configured response to an event. | Notify a supervisor or send an approved webhook. |
| **Measurement / insight** | A summary or interpretation of observations and events across time. | Extended zone occupancy rose 20% week over week, subject to comparable coverage. |

**Rules do not inherently identify errors.** A qualifying condition can be normal, interesting, inefficient, or worth investigating. Its significance is defined by operational context. Similarly, **an event is not automatically an alert**: an event can be logged without interrupting anyone.

## 4.1 Illustrative rule journey

A customer configures: **“If a forklift remains in Loading Zone A for five minutes, record an event.”**

Possible configuration choices:

- Record the occurrence in event history only.
- Record it and notify an operator in the application.
- Record it and send an email or approved webhook.
- Apply more than one of these responses.

The customer can later review how often this condition occurred, when it occurred, how long it lasted if that duration is measurable, and the associated footage. A single continuous occurrence should not be misleadingly represented as multiple independent events unless the configured rule explicitly calls for repeated occurrences.

# 5. Product Capabilities

The following describe desired customer-facing behavior, **not agreed initial-release commitments**. Scope and sequence remain planning decisions.

## 5.1 Camera sources and evidence

Customers can connect supported existing cameras, organize them by facility or operating area, understand source availability, and inspect footage relevant to their operations.

Original footage should remain distinguishable from AI-generated interpretations. Users should understand whether a period has complete, partial, or missing coverage. Authorized users should be able to access appropriate supporting footage within agreed retention and privacy constraints.

Sensewell should not need to become a full-featured video management system to deliver its core value.

## 5.2 Visual observations

Sensewell uses visual analysis to identify relevant entities and conditions in supported scenes. Potential starting capabilities include object detection and classification, basic tracking, and determining whether detected entities occupy configured regions.

Every supported observation should communicate appropriate confidence, limitations, and source context. The platform must distinguish **not observed**, **not present with sufficient supporting evidence**, and **cannot determine**. Customer-facing claims must not imply accuracy or object categories that have not been validated for the use case.

## 5.3 Zones

Users can define meaningful regions on a camera image, give them names, and use them in operational rules. Examples include loading areas, workstations, and staging zones. Changes to monitored areas should not make earlier evidence misleading or historically uninterpretable.

Zones represent areas in the camera's view; they are not automatically calibrated real-world measurements.

## 5.4 Configurable operational rules

Authorized users can define, review, enable, disable, and revise supported rules. Potential conditions include entity presence, entry or exit, occupancy, duration, and restoration or clearing of a condition. The available rule types should be deliberately constrained to what Sensewell can reliably support.

Rules need understandable behavior for duration thresholds, repeated triggering, recovery, and missing observations. Users should be able to tell **why** an event was created and which rule meaning applied at that time. Rule activation and consequential actions require explicit authorization.

**Illustrative non-safety-critical rules:**

- Forklift remains in a loading area longer than five minutes.
- A loading bay is occupied longer than an operational target.
- A vehicle enters a designated dispatch area.
- A station appears unoccupied for a defined interval, if evidence coverage supports the conclusion.
- A camera or intelligence source becomes unavailable.

## 5.5 Operational events and actions

A qualifying rule occurrence becomes an event with an understandable time, location, rule, state, and link to supporting evidence. Customers can browse and filter events, distinguish individual episodes from recurring patterns, and understand missing or uncertain evidence.

Actions are configured separately. Candidate outputs are event history, in-app notifications, email, and approved non-safety-critical webhooks. Notifications should be manageable, not noisy; they may require acknowledgement or resolution depending on the workflow.

An action delivery failure should not erase the event itself. Historical investigations must not accidentally dispatch live notifications or integrations.

## 5.6 Trends, measurements, and insights

The product should help users move from individual events to operational understanding. Candidate capabilities include:

- Event frequency and patterns by period, camera, zone, or facility.
- Duration distributions for conditions whose durations are actually measurable.
- Comparison across shifts, periods, locations, or before/after a process change.
- Identification of recurring or unusual conditions requiring investigation.
- Navigation from summaries to contributing events and footage.
- Clear visibility into data completeness and comparability.

**Important distinction:** Events that only record threshold crossings cannot, by themselves, establish complete measurements of every occurrence. For example, recording only forklift visits longer than five minutes does not reveal the average duration of *all* forklift visits. The scope of measurement collection is therefore an open product decision.

Insights should separate observed patterns from suggested explanations. Sensewell should not claim to have established a root cause without sufficient evidence.

## 5.7 Historical investigation

Users can select relevant periods, cameras, or operational conditions and investigate past footage. Where necessary, Sensewell may derive findings from previously recorded footage rather than relying exclusively on events produced during live monitoring.

Users should be able to inspect progress, coverage limitations, results, and supporting evidence. An inability to determine an answer is a legitimate outcome. Retrospective findings must be distinguishable from events captured during ongoing monitoring, and analysis of the past must not cause unintended present-day actions.

## 5.8 Intelligence-synchronized camera view

Where a camera view is useful, Sensewell should present **video together with its associated intelligence**, not position a raw low-latency stream as the primary product experience.

The envisioned view includes:

- Video from an authorized camera.
- Detection boxes, entity labels, and confidence information where available.
- Optional tracking identifiers.
- Configured zone outlines.
- Relevant rule status, events, and alert context.
- Camera, analysis, and freshness/availability status.

The view may be deliberately delayed so that annotations correspond to the correct visual moment. **Reliable synchronization and meaningful intelligence take precedence over minimum display delay.** No specific number of milliseconds or seconds is assumed at this planning stage.

When analysis is unavailable or too incomplete to support a trustworthy intelligent view, Sensewell should communicate that limitation rather than silently treating unannotated video as an equivalent experience. A separate raw-camera viewing mode is **not** a current product requirement.

## 5.9 Natural-language interaction — potential later capability

Customers may eventually describe rules or ask investigation questions using natural language. Examples include “Record events when a forklift stays here for five minutes” and “How often did that happen last week?”

Any suggested rule or action must be understandable, validated against supported capabilities, and explicitly approved by an authorized user before activation. Explanations should link to evidence and communicate uncertainty. Whether this capability belongs in the initial offer remains open.

# 6. Intelligence Freshness and Time-to-Value

**The product does not have one universal ‘real-time’ requirement.** Different customer jobs require different response times.

| Customer outcome | Potential freshness expectation to validate |
|---|---|
| Review yesterday's operations and identify recurring inefficiencies | Next day may be entirely acceptable. |
| Examine trends during the current shift | Minutes or hours may be sufficient. |
| Be notified about a persistent operational condition | Seconds or minutes after the condition qualifies may be useful. |
| Inspect an annotated camera scene | A short, explicit display delay may be acceptable. |
| Automatically react to safety hazards or protect people/equipment | **Not a Sensewell use case.** |

These examples are **hypotheses**, not performance commitments.

Planning must distinguish:

1. **Time to observation:** How long after an occurrence can Sensewell interpret relevant footage?
2. **Time to event:** When can Sensewell establish that a configured condition was met?
3. **Time to notification or integration:** When does a configured recipient receive the result?
4. **Time to visual explanation:** When can a user inspect correctly synchronized annotations and evidence?
5. **Time to insight:** When can a customer act on a useful trend, report, or investigation?

For operational decision-making, *acceptable timeliness* depends on the action the customer intends to take, not on a universal target such as 50 ms. The eventual product should communicate when available intelligence is delayed, incomplete, or untrustworthy.

# 7. User Experience Principles

Sensewell should feel like an **operational observability workspace** rather than primarily a wall of camera feeds.

The user experience should emphasize:

- **Conditions and events first:** What warrants attention, what happened, and what is recurring?
- **Context and evidence:** Every meaningful finding should be explainable through relevant source footage and observation context.
- **Progressive detail:** Begin with an actionable summary; allow investigation into specific events, times, cameras, and evidence.
- **Clear uncertainty:** Missing footage, ambiguous detections, and incomplete coverage are visible rather than disguised as absence of activity.
- **Deliberate control:** Rule activation, notification configuration, and external actions require appropriate authorization.
- **Consistency:** Preserve the established dark industrial visual direction, subject to customer usability testing.

Potential primary areas include an overview of operational conditions, event history, rules, trends, investigation, camera intelligence views, and administration. Their relative priority and exact structure remain open for design exploration.

# 8. Trust, Privacy, and Product Boundaries

## 8.1 Non-safety-critical use only

Sensewell **must not be offered or relied upon for safety-relevant detection of hazardous situations**. This includes emergency intervention, collision avoidance, personnel protection, protective machinery stopping, and legally mandated safety monitoring. Its alerts and webhooks are for approved **non-safety-critical operational workflows**, not protective control.

A camera detecting a person, vehicle, or piece of equipment does **not** imply that Sensewell has determined the environment to be safe or dangerous.

## 8.2 Evidence and uncertainty

Observations are probabilistic; rules and measurements must not overstate what the available video proves. Original footage should remain separately identifiable from generated annotations or conclusions. The product should show relevant gaps, confidence limits, and timing uncertainty.

## 8.3 Access and privacy

Organizations need appropriate control over which users can access cameras, footage, events, insights, and integrations. Footage and derived information are potentially sensitive. Retention, sharing, deletion, auditability, data residency, and applicable legal/privacy obligations should be addressed as customer-facing product requirements, with the precise policies decided during planning and validation.

## 8.4 Other boundaries

Sensewell is not initially intended to be a general CCTV replacement, unrestricted automation platform, or model-training product. It should not promise universal detection accuracy, a complete history of all physical activity, or fixed hard real-time response across every supported environment.

# 9. Product Scope: Decisions for the Planning Session

The capabilities above describe the **product direction**. They are not a commitment to deliver everything in the first release.

A possible value-led progression, for discussion rather than adoption, is:

| Value increment | Customer proof to seek |
|---|---|
| **A. Trustworthy evidence** | A user can locate and inspect reliable footage for a defined operational period. |
| **B. Configurable operational events** | A user can define a meaningful rule and review correctly captured occurrences without needing notifications. |
| **C. Actionable monitoring** | A user can configure a non-safety-critical event action and respond with appropriate context. |
| **D. Operational observability** | A user can spot a recurring pattern or change over time and trace it to evidence. |
| **E. Deeper investigations** | A user can answer a valuable historical question without manually reviewing all footage. |
| **F. Conversational intelligence** | A user can express supported rules or questions in natural language and approve the resulting actions. |

The order, combination, and minimum credible product are intentionally **not decided here**. In particular, whether historical trends should come before live monitoring depends on customer validation.

# 10. Planning Questions and Unresolved Assumptions

These questions are the primary intended outputs of the planning session.

## Market and value

1. Which initial industry and operational setting are we targeting?
2. Who is the buyer, who uses the product day-to-day, and who benefits financially?
3. Which three operational problems would customers most want solved?
4. What do they do today instead, and what is the cost of the current approach?
5. Would customers pay for next-day insights, near-live monitoring, or both—and why?

## Product meaning and scope

6. Is a customer-configured rule the primary source of events, or should Sensewell also propose potential conditions worth monitoring?
7. Which initial entity categories, zone conditions, and temporal rules are actually needed?
8. Which measurements matter beyond triggered events (e.g., all dwell times versus only threshold exceedances)?
9. What counts as one event episode, and when should repeated or recovered conditions create another event?
10. Which actions are essential initially: log only, in-app, email, webhook, or a subset?
11. Is the primary landing experience an event/insight dashboard, an investigation workspace, or an intelligent camera view?
12. Which historical questions must the first useful product answer?

## Freshness, trust, and operating environment

13. For each priority use case, how late can intelligence arrive before it loses practical value?
14. What level of incorrect or missed detection is acceptable for each use case, and how should uncertainty be shown?
15. What camera environments, coverage constraints, and evidence-retention expectations are realistic for first customers?
16. What should users see when footage or inference is missing, degraded, or delayed?
17. Which privacy, labor, governance, and authorization requirements could affect customer adoption?

## Commercial validation and success

18. What specific operational decision should improve because Sensewell exists?
19. How would we demonstrate value in a pilot, compared with the customer's current practice?
20. Which capabilities are essential for that demonstration, and which should be deferred?

# 11. Proposed Planning Outputs

The planning session should aim to agree on:

- **Target customer and first setting:** A concrete buyer, user, environment, and operational problem.
- **Top use cases:** A small set of specific scenarios written as observable customer outcomes.
- **Core vocabulary:** Shared meanings for observation, rule, event, action, measurement, insight, and investigation.
- **Minimum compelling workflow:** The shortest path from camera evidence to a customer decision of measurable value.
- **Boundaries:** Explicit non-safety-critical positioning and other excluded use cases.
- **Experience priorities:** Which screens and workflows matter first, without designing them prematurely.
- **Evidence and freshness expectations:** Acceptance criteria appropriate to each chosen workflow.
- **Product success measures:** Signals that users can discover, trust, and act on valuable operational information.
- **Open assumptions to test:** Interviews, discovery exercises, or customer pilots needed before committing to delivery scope.

# 12. Definition of Product Success

Sensewell succeeds if a target customer can use camera-derived intelligence to make an operational decision or improvement that would otherwise require more effort, more uncertainty, or unavailable information.

In an early customer validation, success should mean that users can:

1. Define or select a genuinely useful non-safety-critical operational condition.
2. See trustworthy occurrences of that condition, with appropriate coverage and uncertainty information.
3. Retrieve and understand relevant supporting evidence.
4. Learn something useful from events or measurements over time, or act on a configured condition when timeliness matters.
5. Explain what decision or process improvement the intelligence enables.

**Guiding principle:** Build around the operational decisions customers need to make. Intelligence freshness, interfaces, and eventual technical choices should follow those decisions—not dictate them.
