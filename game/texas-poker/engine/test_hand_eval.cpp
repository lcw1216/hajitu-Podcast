#include "hand_eval.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

static int tests_run = 0;
static int tests_passed = 0;
static int tests_failed = 0;

#define ASSERT_EQ(a, b) do { \
    int _a = (a), _b = (b); \
    if (_a != _b) { \
        printf("  FAIL: %s == %d, expected %d (line %d)\n", #a, _a, _b, __LINE__); \
        tests_failed++; \
        return; \
    } \
} while(0)

#define ASSERT_GT(a, b) do { \
    int _a = (a), _b = (b); \
    if (!(_a > _b)) { \
        printf("  FAIL: %s > %s (%d <= %d, line %d)\n", #a, #b, _a, _b, __LINE__); \
        tests_failed++; \
        return; \
    } \
} while(0)

#define ASSERT_LT(a, b) do { \
    int _a = (a), _b = (b); \
    if (!(_a < _b)) { \
        printf("  FAIL: %s < %s (%d >= %d, line %d)\n", #a, #b, _a, _b, __LINE__); \
        tests_failed++; \
        return; \
    } \
} while(0)

#define RUN_TEST(func) do { \
    tests_run++; \
    printf("[%d] %s\n", tests_run, #func); \
    func(); \
} while(0)

static int make_card(int rank, int suit) { return rank * 4 + suit; }

static void test_royal_flush() {
    int cards[7] = {
        make_card(12, 0), make_card(11, 0), make_card(10, 0),
        make_card(9, 0), make_card(8, 0), make_card(2, 1), make_card(3, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_ROYAL_FLUSH);
}

static void test_straight_flush() {
    int cards[7] = {
        make_card(11, 1), make_card(10, 1), make_card(9, 1),
        make_card(8, 1), make_card(7, 1), make_card(2, 0), make_card(3, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_STRAIGHT_FLUSH);
}

static void test_four_of_a_kind() {
    int cards[7] = {
        make_card(12, 0), make_card(12, 1), make_card(12, 2), make_card(12, 3),
        make_card(5, 0), make_card(3, 1), make_card(2, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_FOUR_OF_A_KIND);
}

static void test_full_house() {
    int cards[7] = {
        make_card(10, 0), make_card(10, 1), make_card(10, 2),
        make_card(5, 0), make_card(5, 1), make_card(2, 0), make_card(3, 1)
    };
    ASSERT_EQ(eval_hand(cards), HAND_FULL_HOUSE);
}

static void test_flush() {
    int cards[7] = {
        make_card(12, 2), make_card(10, 2), make_card(8, 2),
        make_card(6, 2), make_card(3, 2), make_card(11, 0), make_card(9, 1)
    };
    ASSERT_EQ(eval_hand(cards), HAND_FLUSH);
}

static void test_straight() {
    int cards[7] = {
        make_card(10, 0), make_card(9, 1), make_card(8, 2),
        make_card(7, 3), make_card(6, 0), make_card(2, 1), make_card(3, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_STRAIGHT);
}

static void test_wheel_straight() {
    int cards[7] = {
        make_card(12, 0), make_card(3, 1), make_card(2, 2),
        make_card(1, 3), make_card(0, 0), make_card(10, 1), make_card(9, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_STRAIGHT);
}

static void test_three_of_a_kind() {
    int cards[7] = {
        make_card(8, 0), make_card(8, 1), make_card(8, 2),
        make_card(5, 0), make_card(3, 1), make_card(2, 2), make_card(1, 3)
    };
    ASSERT_EQ(eval_hand(cards), HAND_THREE_OF_A_KIND);
}

static void test_two_pair() {
    int cards[7] = {
        make_card(10, 0), make_card(10, 1), make_card(5, 2), make_card(5, 3),
        make_card(2, 0), make_card(3, 1), make_card(4, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_TWO_PAIR);
}

static void test_one_pair() {
    int cards[7] = {
        make_card(10, 0), make_card(10, 1), make_card(8, 2),
        make_card(6, 3), make_card(3, 0), make_card(2, 1), make_card(4, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_ONE_PAIR);
}

static void test_high_card() {
    int cards[7] = {
        make_card(12, 0), make_card(10, 1), make_card(8, 2),
        make_card(6, 3), make_card(3, 0), make_card(2, 1), make_card(4, 2)
    };
    ASSERT_EQ(eval_hand(cards), HAND_HIGH_CARD);
}

static void test_compare_royal_flush_vs_straight_flush() {
    int hand_a[7] = {
        make_card(12, 0), make_card(11, 0), make_card(10, 0),
        make_card(9, 0), make_card(8, 0), make_card(2, 1), make_card(3, 2)
    };
    int hand_b[7] = {
        make_card(11, 1), make_card(10, 1), make_card(9, 1),
        make_card(8, 1), make_card(7, 1), make_card(2, 0), make_card(3, 2)
    };
    ASSERT_GT(compare_hands(hand_a, hand_b), 0);
}

static void test_compare_same_rank_different_kickers() {
    int hand_a[7] = {
        make_card(12, 0), make_card(12, 1), make_card(10, 2),
        make_card(8, 3), make_card(6, 0), make_card(3, 1), make_card(2, 2)
    };
    int hand_b[7] = {
        make_card(12, 0), make_card(12, 1), make_card(9, 2),
        make_card(7, 3), make_card(5, 0), make_card(3, 1), make_card(2, 2)
    };
    ASSERT_GT(compare_hands(hand_a, hand_b), 0);
}

static void test_compare_tie() {
    int hand_a[7] = {
        make_card(10, 0), make_card(10, 1), make_card(8, 2),
        make_card(6, 3), make_card(3, 0), make_card(2, 1), make_card(4, 2)
    };
    int hand_b[7] = {
        make_card(10, 2), make_card(10, 3), make_card(8, 0),
        make_card(6, 1), make_card(3, 2), make_card(2, 3), make_card(4, 0)
    };
    ASSERT_EQ(compare_hands(hand_a, hand_b), 0);
}

static void test_eval_hand_full_returns_kickers() {
    int cards[7] = {
        make_card(10, 0), make_card(10, 1), make_card(8, 2),
        make_card(6, 3), make_card(3, 0), make_card(2, 1), make_card(4, 2)
    };
    HandScoreFull result = eval_hand_full(cards);
    ASSERT_EQ(result.rank, HAND_ONE_PAIR);
    ASSERT_EQ(result.kickers[0], 10);
}

static void test_compare_with_scores() {
    int kickers_a[5] = {10, 8, 6, 3, 2};
    int kickers_b[5] = {10, 8, 6, 3, 1};
    ASSERT_GT(compare_with_scores(HAND_ONE_PAIR, kickers_a, HAND_ONE_PAIR, kickers_b), 0);
}

static void test_compare_with_scores_different_rank() {
    int kickers_a[5] = {10, 8, 6, 3, 2};
    int kickers_b[5] = {9, 8, 6, 3, 2};
    ASSERT_GT(compare_with_scores(HAND_ONE_PAIR, kickers_a, HAND_HIGH_CARD, kickers_b), 0);
}

static void test_wheel_straight_low_ace() {
    int cards[7] = {
        make_card(12, 0), make_card(0, 1), make_card(1, 2),
        make_card(2, 3), make_card(3, 0), make_card(10, 1), make_card(9, 2)
    };
    HandScoreFull result = eval_hand_full(cards);
    ASSERT_EQ(result.rank, HAND_STRAIGHT);
    ASSERT_EQ(result.kickers[0], 3);
}

int main() {
    printf("============================================\n");
    printf("  hand_eval Automated Unit Tests\n");
    printf("============================================\n\n");

    RUN_TEST(test_royal_flush);
    RUN_TEST(test_straight_flush);
    RUN_TEST(test_four_of_a_kind);
    RUN_TEST(test_full_house);
    RUN_TEST(test_flush);
    RUN_TEST(test_straight);
    RUN_TEST(test_wheel_straight);
    RUN_TEST(test_three_of_a_kind);
    RUN_TEST(test_two_pair);
    RUN_TEST(test_one_pair);
    RUN_TEST(test_high_card);
    RUN_TEST(test_compare_royal_flush_vs_straight_flush);
    RUN_TEST(test_compare_same_rank_different_kickers);
    RUN_TEST(test_compare_tie);
    RUN_TEST(test_eval_hand_full_returns_kickers);
    RUN_TEST(test_compare_with_scores);
    RUN_TEST(test_compare_with_scores_different_rank);
    RUN_TEST(test_wheel_straight_low_ace);

    printf("\n============================================\n");
    printf("  Results: %d/%d passed", tests_passed + (tests_run - tests_failed), tests_run);
    if (tests_failed > 0) {
        printf(", %d FAILED", tests_failed);
    }
    printf("\n============================================\n");

    return tests_failed > 0 ? 1 : 0;
}
