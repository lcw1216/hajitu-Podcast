import socket
import time
import threading
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HOST = "127.0.0.1"
PORT = 9001
CONCURRENT = 50
TOTAL_REQUESTS = 500


def send_request(method, path, body=None, headers=None):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5)
    try:
        sock.connect((HOST, PORT))
        request_line = f"{method} {path} HTTP/1.1\r\n"
        request_line += f"Host: {HOST}:{PORT}\r\n"

        body_data = b""
        if body:
            body_data = json.dumps(body).encode("utf-8")
            request_line += "Content-Type: application/json\r\n"
            request_line += f"Content-Length: {len(body_data)}\r\n"

        if headers:
            for k, v in headers.items():
                request_line += f"{k}: {v}\r\n"

        request_line += "Connection: close\r\n\r\n"
        sock.sendall(request_line.encode("utf-8") + body_data)

        response = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk

        status_code = 0
        if response:
            first_line = response.split(b"\r\n")[0].decode("utf-8", errors="replace")
            parts = first_line.split(" ")
            if len(parts) >= 2:
                status_code = int(parts[1])

        return status_code, len(response)
    except Exception as e:
        return 0, 0
    finally:
        sock.close()


def test_endpoint(name, method, path, body=None, expected_status=200, count=10):
    print(f"\n--- Testing: {name} ({method} {path}) ---")
    success = 0
    total_time = 0
    errors = 0

    for i in range(count):
        start = time.time()
        status, size = send_request(method, path, body)
        elapsed = (time.time() - start) * 1000
        total_time += elapsed

        if status == expected_status:
            success += 1
        else:
            errors += 1
            if errors <= 3:
                print(f"  Request {i+1} failed: expected {expected_status}, got {status}")

    avg_time = total_time / count if count > 0 else 0
    print(f"  Results: {success}/{count} successful")
    print(f"  Average response time: {avg_time:.1f}ms")
    print(f"  Error rate: {errors/count*100:.1f}%")
    return success == count


def concurrency_test(concurrent, total):
    print(f"\n=== Concurrency Test: {concurrent} threads, {total} requests ===")

    results = {"success": 0, "errors": 0, "times": []}
    lock = threading.Lock()

    def worker():
        start = time.time()
        status, size = send_request("GET", "/api/health")
        elapsed = (time.time() - start) * 1000
        with lock:
            if status == 200:
                results["success"] += 1
            else:
                results["errors"] += 1
            results["times"].append(elapsed)

    threads_per_batch = concurrent
    batches = total // threads_per_batch

    overall_start = time.time()

    for batch in range(batches):
        threads = []
        for _ in range(threads_per_batch):
            t = threading.Thread(target=worker)
            threads.append(t)
            t.start()
        for t in threads:
            t.join()

    overall_elapsed = (time.time() - overall_start) * 1000

    times = results["times"]
    times.sort()

    print(f"  Total requests: {results['success'] + results['errors']}")
    print(f"  Successful: {results['success']}")
    print(f"  Errors: {results['errors']}")
    print(f"  Total time: {overall_elapsed:.0f}ms")
    print(f"  Requests/sec: {(results['success'] + results['errors']) / (overall_elapsed / 1000):.1f}")
    if times:
        print(f"  Min response time: {min(times):.1f}ms")
        print(f"  Max response time: {max(times):.1f}ms")
        print(f"  Avg response time: {sum(times) / len(times):.1f}ms")
        p50 = times[len(times) // 2]
        p90 = times[int(len(times) * 0.9)]
        p99 = times[int(len(times) * 0.99)]
        print(f"  P50: {p50:.1f}ms")
        print(f"  P90: {p90:.1f}ms")
        print(f"  P99: {p99:.1f}ms")


def static_file_test():
    print("\n--- Testing: Static File Serving ---")
    start = time.time()
    status, size = send_request("GET", "/static/ace_of_spades.png")
    elapsed = (time.time() - start) * 1000
    print(f"  Status: {status}, Size: {size} bytes, Time: {elapsed:.1f}ms")
    return status == 200


def run_all_tests():
    print("=" * 60)
    print("  Texas Poker Server - Performance Test Suite")
    print("=" * 60)

    print("\n[1/5] Connectivity Test")
    status, _ = send_request("GET", "/api/health")
    if status != 200:
        print(f"  FAILED: Server not reachable (status={status})")
        print("  Make sure the server is running: python app.py")
        return
    print("  Server is reachable")

    print("\n[2/5] API Endpoint Tests")
    test_endpoint("Health Check", "GET", "/api/health")
    test_endpoint("Index", "GET", "/")
    test_endpoint("Card List", "GET", "/api/cards")
    test_endpoint("Game Config", "GET", "/api/config")
    test_endpoint("Room List", "GET", "/api/rooms")
    test_endpoint("Register (missing data)", "POST", "/api/register", {}, expected_status=400)
    test_endpoint("Login (invalid)", "POST", "/api/login", {"username": "nonexistent", "password": "wrong"}, expected_status=401)
    test_endpoint("User Not Found", "GET", "/api/users/99999", expected_status=404)
    test_endpoint("Room Not Found", "GET", "/api/rooms/99999", expected_status=404)

    print("\n[3/5] Static File Test")
    static_file_test()

    print("\n[4/5] Concurrency Test")
    concurrency_test(CONCURRENT, TOTAL_REQUESTS)

    print("\n[5/5] Stress Test (100 concurrent, 1000 requests)")
    concurrency_test(100, 1000)

    print("\n" + "=" * 60)
    print("  All tests completed!")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()
