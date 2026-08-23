package retry

import (
    "context"
    "errors"
    "testing"
    "time"
)

func TestSuccessDoesNotRetry(t *testing.T) {
    calls := 0
    err := Retry(context.Background(), 3, time.Millisecond, func() error { calls++; return nil })
    if err != nil || calls != 1 { t.Fatalf("err=%v calls=%d, want nil and 1", err, calls) }
}

func TestReturnsLastErrorAfterAttempts(t *testing.T) {
    first, last := errors.New("first"), errors.New("last")
    calls := 0
    err := Retry(context.Background(), 2, time.Millisecond, func() error { calls++; if calls == 1 { return first }; return last })
    if !errors.Is(err, last) || calls != 2 { t.Fatalf("err=%v calls=%d, want last and 2", err, calls) }
}

func TestCancellationInterruptsBackoff(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    calls, start := 0, time.Now()
    err := Retry(ctx, 5, time.Second, func() error { calls++; cancel(); return errors.New("retry") })
    if !errors.Is(err, context.Canceled) { t.Fatalf("err=%v, want context.Canceled", err) }
    if calls != 1 { t.Fatalf("calls=%d, want 1", calls) }
    if time.Since(start) > 250*time.Millisecond { t.Fatal("cancellation did not interrupt backoff") }
}

func TestRejectsInvalidArguments(t *testing.T) {
    if Retry(context.Background(), 0, 0, func() error { return nil }) == nil { t.Fatal("zero attempts should fail") }
    if Retry(context.Background(), 1, 0, nil) == nil { t.Fatal("nil operation should fail") }
}
