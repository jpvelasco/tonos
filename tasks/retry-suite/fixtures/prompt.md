# Task: implement the retry primitive

Write `retry.go` in this directory declaring `package retry` and exposing:

```go
func Retry(ctx context.Context, attempts int, backoff time.Duration, op func() error) error
```

Semantics required by `retry_test.go`:

1. A successful operation is called exactly once and `nil` is returned.
2. When every attempt fails, the **last** error is returned.
3. Cancellation of `ctx` interrupts backoff immediately and returns
   `ctx.Err()`.
4. Zero attempts or a nil operation return a non-nil error.

Rules:

- Only `retry.go` may be created or modified.
- Do not modify `go.mod` or `retry_test.go`.
- Verify with: `go test ./...`
