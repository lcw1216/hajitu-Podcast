#include "hand_eval.h"
#include <algorithm>
#include <cstring>

static inline int card_rank(int card) { return card / 4; }
static inline int card_suit(int card) { return card % 4; }

struct HandScore {
    int rank;
    int kickers[5];
};

static int compare_scores(const HandScore& a, const HandScore& b) {
    if (a.rank != b.rank)
        return a.rank - b.rank;
    for (int i = 0; i < 5; i++) {
        if (a.kickers[i] != b.kickers[i])
            return a.kickers[i] - b.kickers[i];
    }
    return 0;
}

static HandScore eval_5cards(const int cards[5]) {
    HandScore score;
    int ranks[5], suits[5];
    for (int i = 0; i < 5; i++) {
        ranks[i] = card_rank(cards[i]);
        suits[i] = card_suit(cards[i]);
    }

    int rank_counts[13] = {0};
    for (int i = 0; i < 5; i++)
        rank_counts[ranks[i]]++;

    int four_kind = -1, three_kind = -1;
    int pairs[2] = {-1, -1};
    int pair_count = 0;
    for (int r = 12; r >= 0; r--) {
        if (rank_counts[r] == 4) four_kind = r;
        if (rank_counts[r] == 3) three_kind = r;
        if (rank_counts[r] == 2) {
            pairs[pair_count++] = r;
        }
    }

    bool is_flush = true;
    for (int i = 1; i < 5; i++) {
        if (suits[i] != suits[0]) { is_flush = false; break; }
    }

    bool is_straight = false;
    int straight_high = -1;
    if (ranks[0] - ranks[4] == 4) {
        bool consecutive = true;
        for (int i = 1; i < 5; i++) {
            if (ranks[i - 1] - ranks[i] != 1) { consecutive = false; break; }
        }
        if (consecutive) {
            is_straight = true;
            straight_high = ranks[0];
        }
    }
    if (!is_straight && ranks[0] == 12 && ranks[1] == 3 && ranks[2] == 2 &&
        ranks[3] == 1 && ranks[4] == 0) {
        is_straight = true;
        straight_high = 3;
    }

    if (is_flush && is_straight) {
        if (straight_high == 12) {
            score.rank = HAND_ROYAL_FLUSH;
        } else {
            score.rank = HAND_STRAIGHT_FLUSH;
        }
        score.kickers[0] = straight_high;
        for (int i = 1; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (four_kind >= 0) {
        score.rank = HAND_FOUR_OF_A_KIND;
        score.kickers[0] = four_kind;
        for (int i = 0; i < 5; i++) {
            if (ranks[i] != four_kind) {
                score.kickers[1] = ranks[i];
                break;
            }
        }
        for (int i = 2; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (three_kind >= 0 && pair_count >= 1) {
        score.rank = HAND_FULL_HOUSE;
        score.kickers[0] = three_kind;
        score.kickers[1] = pairs[0];
        for (int i = 2; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (is_flush) {
        score.rank = HAND_FLUSH;
        for (int i = 0; i < 5; i++) score.kickers[i] = ranks[i];
        return score;
    }

    if (is_straight) {
        score.rank = HAND_STRAIGHT;
        score.kickers[0] = straight_high;
        for (int i = 1; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (three_kind >= 0) {
        score.rank = HAND_THREE_OF_A_KIND;
        score.kickers[0] = three_kind;
        int ki = 1;
        for (int i = 0; i < 5; i++) {
            if (ranks[i] != three_kind)
                score.kickers[ki++] = ranks[i];
        }
        for (int i = ki; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (pair_count == 2) {
        score.rank = HAND_TWO_PAIR;
        score.kickers[0] = pairs[0];
        score.kickers[1] = pairs[1];
        for (int i = 0; i < 5; i++) {
            if (ranks[i] != pairs[0] && ranks[i] != pairs[1]) {
                score.kickers[2] = ranks[i];
                break;
            }
        }
        for (int i = 3; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    if (pair_count == 1) {
        score.rank = HAND_ONE_PAIR;
        score.kickers[0] = pairs[0];
        int ki = 1;
        for (int i = 0; i < 5; i++) {
            if (ranks[i] != pairs[0])
                score.kickers[ki++] = ranks[i];
        }
        for (int i = ki; i < 5; i++) score.kickers[i] = -1;
        return score;
    }

    score.rank = HAND_HIGH_CARD;
    for (int i = 0; i < 5; i++) score.kickers[i] = ranks[i];
    return score;
}

int eval_hand(const int cards[7]) {
    HandScore best_score;
    best_score.rank = -1;

    for (int a = 0; a < 3; a++) {
        for (int b = a + 1; b < 4; b++) {
            for (int c = b + 1; c < 5; c++) {
                for (int d = c + 1; d < 6; d++) {
                    for (int e = d + 1; e < 7; e++) {
                        int combo[5] = {cards[a], cards[b], cards[c], cards[d], cards[e]};
                        std::sort(combo, combo + 5,
                            [](int x, int y) { return card_rank(x) > card_rank(y); });
                        HandScore sc = eval_5cards(combo);
                        if (compare_scores(sc, best_score) > 0) {
                            best_score = sc;
                        }
                    }
                }
            }
        }
    }
    return best_score.rank;
}

HandScoreFull eval_hand_full(const int cards[7]) {
    HandScore best_score;
    best_score.rank = -1;

    for (int a = 0; a < 3; a++) {
        for (int b = a + 1; b < 4; b++) {
            for (int c = b + 1; c < 5; c++) {
                for (int d = c + 1; d < 6; d++) {
                    for (int e = d + 1; e < 7; e++) {
                        int combo[5] = {cards[a], cards[b], cards[c], cards[d], cards[e]};
                        std::sort(combo, combo + 5,
                            [](int x, int y) { return card_rank(x) > card_rank(y); });
                        HandScore sc = eval_5cards(combo);
                        if (compare_scores(sc, best_score) > 0) {
                            best_score = sc;
                        }
                    }
                }
            }
        }
    }

    HandScoreFull result;
    result.rank = best_score.rank;
    for (int i = 0; i < 5; i++) {
        result.kickers[i] = best_score.kickers[i];
    }
    return result;
}

int compare_with_scores(int rank_a, const int kickers_a[5], int rank_b, const int kickers_b[5]) {
    if (rank_a != rank_b)
        return rank_a - rank_b;
    for (int i = 0; i < 5; i++) {
        if (kickers_a[i] != kickers_b[i])
            return kickers_a[i] - kickers_b[i];
    }
    return 0;
}

int compare_hands(const int hand_a[7], const int hand_b[7]) {
    HandScore best_a, best_b;
    best_a.rank = -1;
    best_b.rank = -1;

    for (int a = 0; a < 3; a++) {
        for (int b = a + 1; b < 4; b++) {
            for (int c = b + 1; c < 5; c++) {
                for (int d = c + 1; d < 6; d++) {
                    for (int e = d + 1; e < 7; e++) {
                        int combo[5] = {hand_a[a], hand_a[b], hand_a[c], hand_a[d], hand_a[e]};
                        std::sort(combo, combo + 5,
                            [](int x, int y) { return card_rank(x) > card_rank(y); });
                        HandScore sc = eval_5cards(combo);
                        if (compare_scores(sc, best_a) > 0)
                            best_a = sc;
                    }
                }
            }
        }
    }

    for (int a = 0; a < 3; a++) {
        for (int b = a + 1; b < 4; b++) {
            for (int c = b + 1; c < 5; c++) {
                for (int d = c + 1; d < 6; d++) {
                    for (int e = d + 1; e < 7; e++) {
                        int combo[5] = {hand_b[a], hand_b[b], hand_b[c], hand_b[d], hand_b[e]};
                        std::sort(combo, combo + 5,
                            [](int x, int y) { return card_rank(x) > card_rank(y); });
                        HandScore sc = eval_5cards(combo);
                        if (compare_scores(sc, best_b) > 0)
                            best_b = sc;
                    }
                }
            }
        }
    }

    return compare_scores(best_a, best_b);
}