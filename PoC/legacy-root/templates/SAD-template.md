# System Architecture Design

## Document Control

| Field | Value |
|-------|-------|
| Project Name | {project} |
| Version | 1.0 |
| Status | Draft |

## 1. Architecture Overview

### 1.1 Architectural Style
**Style:** {layered / hexagonal / microservices / event-driven / CQRS / hybrid}

**Rationale:**

### 1.2 System Context (C4 Level 1)

```mermaid
flowchart LR
    U[Users] --> SYS
    SYS --> EXT[External Systems]
```

## 2. Container / Component View (C4 Level 2)

```mermaid
flowchart TB
    subgraph "Containers"
    end
```

## 3. Component Decomposition

### 3.1 Component: {Name}
- **Responsibility:**
- **Public Interface:**
- **Dependencies:**
- **Design Patterns:**

## 4. Data Architecture

### 4.1 Logical Data Model

```mermaid
erDiagram
```

### 4.2 Physical Schema Outline

## 5. API Design

### 5.1 Endpoints
| Method | Path | Purpose | Request | Response |

### 5.2 API Security

## 6. Technology Choices

| Technology | Purpose | Alternatives Considered | Rationale |
|-----------|---------|------------------------|-----------|

## 7. Non-Functional Design

### 7.1 Performance Strategy
### 7.2 Scalability Strategy
### 7.3 Availability Strategy
### 7.4 Security Design
### 7.5 Observability

## 8. Deployment View

## 9. Trade-off Register

| Decision | Chosen | Alternative | Cost Accepted |
|----------|--------|-------------|---------------|

## 10. Risks & Mitigations
