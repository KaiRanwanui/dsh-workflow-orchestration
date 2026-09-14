---
name: uml-modeling
description: Use when creating UML diagrams — class diagrams, sequence diagrams, state diagrams, use case diagrams, deployment diagrams. Covers Mermaid syntax for each diagram type with best-practice conventions.
---

# UML Modeling with Mermaid

## Conventions

- Use `classDiagram` for structural models (domain model, class design)
- Use `sequenceDiagram` for behavioral models (API flows, component interactions)
- Use `stateDiagram-v2` for lifecycle models
- Use `flowchart` for process flows and C4 container diagrams
- Use `erDiagram` for data models (see api-design skill instead for ER specifics)

## Class Diagram

```mermaid
classDiagram
    class Order {
        +OrderId id
        +Money totalAmount
        +OrderStatus status
        +place() void
        +cancel() void
    }
    class OrderLine {
        +ProductId product
        +Quantity quantity
        +Money unitPrice
    }
    class Customer {
        +CustomerId id
        +String name
    }
    Customer "1" --> "*" Order : places
    Order "1" --> "*" OrderLine : contains
    OrderLine "*" --> "1" Product : references
```

**Conventions:**
- Use `+` for public, `-` for private
- Use domain names (not database column names) for attributes
- Relationships: `-->` association, `--|>` inheritance, `..>` dependency, `*--` composition, `o--` aggregation

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant API
    participant Service
    participant Repository
    participant Database

    User->>API: POST /orders
    API->>Service: createOrder(command)
    Service->>Repository: save(order)
    Repository->>Database: INSERT
    Database-->>Repository: OK
    Repository-->>Service: order
    Service-->>API: orderId
    API-->>User: 201 Created
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted : submit()
    Submitted --> Approved : approve()
    Submitted --> Rejected : reject()
    Approved --> Published : publish()
    Published --> [*]
```

## C4 Container Diagram (via flowchart)

```mermaid
flowchart LR
    subgraph "User"
        U[User Browser]
    end
    subgraph "System Boundary"
        subgraph "Web Server"
            FE[SPA Frontend]
        end
        subgraph "App Server"
            API[API Gateway]
            SVC1[Order Service]
            SVC2[Inventory Service]
        end
        subgraph "Data"
            DB[(Primary DB)]
            CACHE[(Cache)]
            QUEUE[/Message Queue/]
        end
    end
    U --> FE
    FE --> API
    API --> SVC1
    API --> SVC2
    SVC1 --> DB
    SVC2 --> CACHE
    SVC1 --> QUEUE
    SVC2 --> QUEUE
```
