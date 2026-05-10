#include "hand_eval.h"
#include <iostream>
#include <string>
#include <cctype>
#include <cstdlib>
#include <cstring>

static const char* HAND_NAMES[] = {
    "High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"
};

static const char* HAND_NAMES_CN[] = {
    "Gao Pai", "Yi Dui", "Liang Dui", "San Tiao", "Shun Zi",
    "Tong Hua", "Hu Lu", "Si Tiao", "Tong Hua Shun", "Huang Jia Tong Hua Shun"
};

static int rank_char_to_int(char c) {
    c = (char)toupper((unsigned char)c);
    switch (c) {
        case '2': return 0;
        case '3': return 1;
        case '4': return 2;
        case '5': return 3;
        case '6': return 4;
        case '7': return 5;
        case '8': return 6;
        case '9': return 7;
        case 'T': return 8;
        case 'J': return 9;
        case 'Q': return 10;
        case 'K': return 11;
        case 'A': return 12;
        default:  return -1;
    }
}

static int suit_char_to_int(char c) {
    c = (char)tolower((unsigned char)c);
    switch (c) {
        case 's': return 0;
        case 'h': return 1;
        case 'd': return 2;
        case 'c': return 3;
        default:  return -1;
    }
}

static const char* rank_int_to_str(int r) {
    static const char* tbl[] = {"2","3","4","5","6","7","8","9","T","J","Q","K","A"};
    return (r >= 0 && r <= 12) ? tbl[r] : "?";
}

static const char* suit_int_to_str(int s) {
    static const char* tbl[] = {"S","H","D","C"};
    return (s >= 0 && s <= 3) ? tbl[s] : "?";
}

static int parse_card(const char* token) {
    int len = (int)strlen(token);
    if (len < 2 || len > 3) return -1;

    int rank = -1, suit = -1;
    if (len == 2) {
        rank = rank_char_to_int(token[0]);
        suit = suit_char_to_int(token[1]);
    } else {
        if (token[0] == '1' && token[1] == '0') {
            rank = 8;
            suit = suit_char_to_int(token[2]);
        } else {
            return -1;
        }
    }
    if (rank < 0 || suit < 0) return -1;
    return rank * 4 + suit;
}

static void print_cards(const int cards[7]) {
    for (int i = 0; i < 7; i++) {
        int r = cards[i] / 4;
        int s = cards[i] % 4;
        std::cout << rank_int_to_str(r) << suit_int_to_str(s);
        if (i < 6) std::cout << " ";
    }
}

static void print_help() {
    std::cout << "\n";
    std::cout << "============================================================\n";
    std::cout << "  Texas Hold'em Hand Evaluator - Manual Test Tool\n";
    std::cout << "============================================================\n";
    std::cout << "\n";
    std::cout << "  Input Format:\n";
    std::cout << "    Each card: [rank][suit], 2-3 chars per card\n";
    std::cout << "    Ranks: 2 3 4 5 6 7 8 9 T J Q K A\n";
    std::cout << "    Suits:  s=Spade, h=Heart, d=Diamond, c=Club\n";
    std::cout << "    Example: As Kh Qs Js Ts 2c 3d\n";
    std::cout << "\n";
    std::cout << "  Menu:\n";
    std::cout << "    1  - Evaluate single hand (input 7 cards)\n";
    std::cout << "    2  - Compare two hands (each input 7 cards)\n";
    std::cout << "    h  - Show this help\n";
    std::cout << "    q  - Quit\n";
    std::cout << "\n";
    std::cout << "  Hand Ranks: 9=Royal Flush 8=Straight Flush 7=Four of a Kind\n";
    std::cout << "              6=Full House 5=Flush 4=Straight 3=Three of a Kind\n";
    std::cout << "              2=Two Pair 1=One Pair 0=High Card\n";
    std::cout << "============================================================\n";
}

static bool read_7cards(const char* prompt, int out[7]) {
    std::cout << prompt << "\n";
    std::cout << "  Enter 7 cards, space separated (e.g., As Kh Qs Js Ts 2c 3d):\n";
    std::cout << "  > ";

    std::string line;
    std::getline(std::cin, line);
    if (line.empty()) {
        std::cout << "  [ERROR] Input is empty\n";
        return false;
    }

    int cards[7];
    int count = 0;
    const char* p = line.c_str();

    while (*p) {
        while (*p == ' ' || *p == '\t') p++;
        if (*p == '\0') break;
        if (count >= 7) {
            std::cout << "  [ERROR] More than 7 cards entered\n";
            return false;
        }
        char token[4] = {0};
        int ti = 0;
        while (*p && *p != ' ' && *p != '\t' && ti < 3) {
            token[ti++] = *p++;
        }
        token[ti] = '\0';
        int cid = parse_card(token);
        if (cid < 0) {
            std::cout << "  [ERROR] Cannot recognize card: \"" << token << "\"\n";
            return false;
        }
        cards[count++] = cid;
    }

    if (count != 7) {
        std::cout << "  [ERROR] Need exactly 7 cards, you entered " << count << "\n";
        return false;
    }

    bool dup[52] = {false};
    for (int i = 0; i < 7; i++) {
        if (dup[cards[i]]) {
            std::cout << "  [ERROR] Duplicate card: "
                      << rank_int_to_str(cards[i] / 4)
                      << suit_int_to_str(cards[i] % 4) << "\n";
            return false;
        }
        dup[cards[i]] = true;
    }

    for (int i = 0; i < 7; i++) out[i] = cards[i];
    return true;
}

static void do_eval_single() {
    int cards[7];
    if (!read_7cards("=== Evaluate Single Hand ===", cards)) return;

    int rank = eval_hand(cards);
    std::cout << "\n";
    std::cout << "  +---------------------------------------------------+\n";
    std::cout << "  | Input:   ";
    print_cards(cards);
    std::cout << "\n";
    std::cout << "  | Rank:    " << rank;
    std::cout << " (" << HAND_NAMES[rank] << ")\n";
    std::cout << "  +---------------------------------------------------+\n";
}

static void do_compare() {
    int hand_a[7], hand_b[7];

    std::cout << "\n=== Compare Two Hands ===\n";
    std::cout << "  Enter first hand (Player A)\n";
    if (!read_7cards("", hand_a)) return;

    std::cout << "\n  Enter second hand (Player B)\n";
    if (!read_7cards("", hand_b)) return;

    int rank_a = eval_hand(hand_a);
    int rank_b = eval_hand(hand_b);
    int cmp = compare_hands(hand_a, hand_b);

    std::cout << "\n";
    std::cout << "  +---------------------------------------------------+\n";
    std::cout << "  | Player A: ";
    print_cards(hand_a);
    std::cout << "\n";
    std::cout << "  | Hand:     " << HAND_NAMES[rank_a] << " (rank " << rank_a << ")\n";
    std::cout << "  |\n";
    std::cout << "  | Player B: ";
    print_cards(hand_b);
    std::cout << "\n";
    std::cout << "  | Hand:     " << HAND_NAMES[rank_b] << " (rank " << rank_b << ")\n";
    std::cout << "  |\n";
    std::cout << "  | Result:   ";
    if (cmp > 0) {
        std::cout << "Player A wins!\n";
    } else if (cmp < 0) {
        std::cout << "Player B wins!\n";
    } else {
        std::cout << "Tie!\n";
    }
    std::cout << "  +---------------------------------------------------+\n";
}

int main() {
    print_help();

    while (true) {
        std::cout << "\n  Select [1/2/h/q] > ";
        std::string cmd;
        std::getline(std::cin, cmd);

        if (cmd.empty()) continue;

        char c = (char)tolower((unsigned char)cmd[0]);

        if (c == 'q') {
            std::cout << "  Goodbye!\n";
            break;
        }
        if (c == 'h') {
            print_help();
            continue;
        }
        if (c == '1') {
            do_eval_single();
            continue;
        }
        if (c == '2') {
            do_compare();
            continue;
        }

        std::cout << "  [ERROR] Invalid option \"" << cmd << "\", enter 1/2/h/q\n";
    }

    return 0;
}