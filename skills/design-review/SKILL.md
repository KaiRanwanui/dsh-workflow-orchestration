---
name: design-review
description: Use when reviewing a completed design before presenting it — a structured checklist covering completeness, consistency, feasibility, and non-functional coverage. Run this skill before calling exit_plan_mode.
---

# Design Review Checklist

## 1. Completeness

- [ ] Every functional requirement is addressed by at least one component
- [ ] Every external system/actor appears in the system context diagram
- [ ] All API endpoints are specified with request/response shapes
- [ ] All domain entities appear in the data model
- [ ] All states and transitions are defined for stateful entities
- [ ] Error handling is specified for every integration point

## 2. Consistency

- [ ] Naming is consistent across diagrams and prose (same term = same thing)
- [ ] Data model types match API payload types
- [ ] Component responsibilities don't overlap (no two components own the same data)
- [ ] Diagram relationships match prose descriptions
- [ ] Version numbers are consistent when dependencies are versioned

## 3. Feasibility

- [ ] Technology choices are justified with concrete reasons
- [ ] No technology is chosen "because it's popular"
- [ ] Integration points specify protocol, format, and failure mode
- [ ] Deployment model is stated (containers, serverless, monolith)
- [ ] Known technical risks are identified with mitigation

## 4. Non-Functional Coverage

- [ ] **Performance** — latency targets, throughput targets, bottleneck strategy
- [ ] **Scalability** — horizontal/vertical, statelessness, data partitioning plan
- [ ] **Availability** — uptime target, redundancy strategy, failover approach
- [ ] **Security** — authentication, authorization, data protection, threat model summary
- [ ] **Observability** — logging, metrics, tracing strategy
- [ ] **Maintainability** — coupling assessment, extension points, configuration management

## 5. Design Patterns

- [ ] Each pattern used is named and its application point is identified
- [ ] No pattern is applied "because the book says so" — a concrete problem must drive it
- [ ] Anti-patterns are explicitly avoided where they commonly appear

## 6. Trade-offs

- [ ] Every significant architectural decision has a documented trade-off
- [ ] The chosen option has a clear rationale
- [ ] Rejected alternatives state why they don't fit
- [ ] No design claims to have "no downsides"

## 7. Document Quality

- [ ] Diagrams render correctly (validate Mermaid syntax)
- [ ] No orphaned references (diagram mentions a component not described in text)
- [ ] Acronyms are expanded on first use
- [ ] Target audience is clear (architect, developer, stakeholder)

## Review Outcome

If any checkbox is unchecked, address it before calling exit_plan_mode. A check means the item is addressed in the design document, not that the reviewer "feels" it is OK.
