---
name: api-design
description: Use when designing RESTful or GraphQL APIs — resource modeling, endpoint design, request/response shapes, error handling, pagination, versioning, and OpenAPI specification generation.
---

# API Design Reference

## RESTful API Design

### Resource Naming

```
GET    /orders              # List orders
POST   /orders              # Create order
GET    /orders/{id}         # Get order
PUT    /orders/{id}         # Replace order
PATCH  /orders/{id}         # Partial update
DELETE /orders/{id}         # Delete order
GET    /orders/{id}/items   # Sub-resource
```

### Request / Response Conventions

```json
// POST /orders — Request
{
  "customerId": "cust_123",
  "items": [
    {"productId": "prod_456", "quantity": 2}
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Beijing",
    "postalCode": "100000"
  }
}

// 201 Created — Response
{
  "data": {
    "id": "ord_789",
    "status": "CREATED",
    "totalAmount": {"amount": 19900, "currency": "CNY"},
    "createdAt": "2026-01-15T10:30:00Z"
  }
}
```

### Error Response

```json
// 400 Bad Request
{
  "error": {
    "code": "INVALID_QUANTITY",
    "message": "Quantity must be positive",
    "details": [{"field": "items[0].quantity", "reason": "value is 0"}]
  }
}
```

### Pagination

Cursor-based for large datasets:
```
GET /orders?cursor=ord_100&limit=20
```

Response includes `nextCursor` for the next page, `null` when exhausted.

### Versioning

Use URL prefix: `/v1/orders`, `/v2/orders`
Change version on breaking changes only — additive changes stay in the same version.

## GraphQL API Design

### Schema Outline

```graphql
type Query {
  orders(first: Int, after: String): OrderConnection!
  order(id: ID!): Order
}

type Mutation {
  createOrder(input: CreateOrderInput!): CreateOrderPayload!
  cancelOrder(id: ID!): CancelOrderPayload!
}

type Order {
  id: ID!
  customer: Customer!
  items: [OrderItem!]!
  status: OrderStatus!
  totalAmount: Money!
  createdAt: DateTime!
}
```

## API Security Checklist

- [ ] Authentication (JWT / OAuth2 / API Key)
- [ ] Authorization (role-based, per-resource)
- [ ] Input validation (whitelist, not blacklist)
- [ ] Rate limiting (per-user, per-endpoint)
- [ ] Idempotency keys for mutating operations
- [ ] HTTPS only
- [ ] CORS policy
