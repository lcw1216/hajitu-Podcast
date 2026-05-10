#ifndef HAND_EVAL_H
#define HAND_EVAL_H

#ifdef __cplusplus
extern "C" {
#endif

#define HAND_HIGH_CARD       0
#define HAND_ONE_PAIR        1
#define HAND_TWO_PAIR        2
#define HAND_THREE_OF_A_KIND 3
#define HAND_STRAIGHT        4
#define HAND_FLUSH           5
#define HAND_FULL_HOUSE      6
#define HAND_FOUR_OF_A_KIND  7
#define HAND_STRAIGHT_FLUSH  8
#define HAND_ROYAL_FLUSH     9

int eval_hand(const int cards[7]);

int compare_hands(const int hand_a[7], const int hand_b[7]);

#ifdef __cplusplus
}
#endif

#endif