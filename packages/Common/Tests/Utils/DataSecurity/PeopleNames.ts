/*
 * PEOPLE'S NAMES, GIVEN AND FAMILY, IN MANY LANGUAGES (#11098).
 *
 * What CodeWords.test.ts holds the vocabulary of code's words to: a
 * template read from one record keeps only that vocabulary's words, so
 * none of these may be kept as a template writes a name - capitalized, or
 * in capitals - and only the vocabulary's NAME_LIKE_WORDS may be kept in
 * lower case. The most common names of the countries OneUptime's customers
 * log in, written in the Latin alphabet as their people write them in
 * ASCII. No person: the commonest names are everyone's.
 */

export const GIVEN_NAMES: ReadonlyArray<string> = [
  // English.
  "Aaron Abigail Ada Adam Adrian Alan Albert Alex Alexander Alexandra",
  "Alice Alison Amanda Amber Amelia Amy Andrew Angela Anna Anne Anthony",
  "April Arthur Ashley Audrey August Austin Barbara Ben Benjamin Beth",
  "Betty Beverly Bill Billy Bob Bobby Bonnie Brad Bradley Brandon Brenda",
  "Brian Brittany Bruce Bryan Caleb Cameron Carl Carol Caroline Carolyn",
  "Carter Cassandra Catherine Charles Charlie Charlotte Chase Chloe Chris",
  "Christian Christina Christine Christopher Cindy Claire Clara Colin",
  "Connor Craig Crystal Cynthia Daisy Dale Daniel Danielle Danny Daphne",
  "David Dawn Dean Deborah Debra Dennis Derek Diana Diane Donald Donna",
  "Doris Dorothy Douglas Dylan Earl Edward Eleanor Elijah Elizabeth Ella",
  "Ellen Emily Emma Eric Erica Ethan Eugene Eva Evelyn Faith Frances Frank",
  "Fred Gabriel Gail Gary Gavin George Gerald Gloria Grace Grant Greg",
  "Gregory Hannah Harold Harper Harry Hazel Heather Helen Henry Holly Hope",
  "Howard Hunter Ian Iris Isaac Isabella Ivy Jack Jackson Jacob Jade James",
  "Jamie Jane Janet Janice Jason Jean Jeffrey Jennifer Jeremy Jerry Jesse",
  "Jessica Jill Jim Joan Joe John Johnny Jonathan Jordan Joseph Josh",
  "Joshua Joy Joyce Judith Judy Julia Julie June Justin Karen Kate",
  "Katherine Kathleen Kathryn Katie Keith Kelly Ken Kenneth Kevin Kim",
  "Kimberly Kyle Larry Laura Lauren Lawrence Leah Lee Leo Leon Liam Lily",
  "Linda Lisa Logan Lori Louis Louise Lucas Lucy Luke Lynn Madison Mark",
  "Martha Martin Mary Mason Matthew Max Megan Melanie Melissa Michael",
  "Michelle Mike Mila Miles Molly Nancy Natalie Nathan Nicholas Nicole",
  "Noah Norma Olivia Oliver Oscar Owen Pamela Patricia Patrick Paul Paula",
  "Pearl Peggy Penny Peter Philip Phyllis Rachel Ralph Randy Ray Raymond",
  "Rebecca Reed Richard Riley Rita Rob Robert Robin Roger Ronald Rose Ross",
  "Roy Ruby Russell Ruth Ryan Sally Samantha Samuel Sandra Sara Sarah",
  "Scott Sean Sharon Shawn Shirley Sky Sophia Sophie Stacy Stanley",
  "Stephanie Stephen Steve Steven Summer Susan Taylor Teresa Terry Theresa",
  "Thomas Tiffany Timothy Tina Todd Tom Tony Tracy Travis Tyler Valerie",
  "Vanessa Victor Victoria Vincent Virginia Walter Wayne Wendy Will",
  "William Willow Winter Zachary Zoe",
  // Spanish and Portuguese.
  "Alejandro Ana Andres Antonio Beatriz Camila Carlos Carmen Catalina",
  "Diego Dolores Eduardo Elena Emilio Enrique Esperanza Fernando Francisco",
  "Gabriela Guadalupe Guillermo Isabel Javier Jesus Joao Jorge Jose Juan",
  "Juana Leticia Lucia Luis Manuel Marco Marcos Margarita Maria Mariana",
  "Mario Marta Mateo Miguel Natalia Pablo Paola Pedro Rafael Ramon Raul",
  "Ricardo Roberto Rodrigo Rosa Santiago Sergio Sofia Teresa Valentina",
  "Gonzalo Thiago Joaquim Goncalo",
  // French, Italian, German, Dutch, Nordic.
  "Alain Amelie Andre Antoine Aurelie Bernard Camille Celine Chantal",
  "Christophe Claude Elodie Etienne Francois Guillaume Helene Jacques",
  "Laurent Manon Marie Mathieu Michel Nathalie Nicolas Olivier Philippe",
  "Pierre Sylvie Thierry Valerie Yves Alessandro Andrea Antonella",
  "Chiara Davide Federica Francesca Giovanni Giulia Giuseppe Lorenzo Luca",
  "Marco Matteo Paolo Roberta Salvatore Simona Stefano Anke Birgit",
  "Dieter Franz Friedrich Fritz Gerhard Gunther Hans Heinz Helga Ingrid",
  "Jurgen Karl Klaus Lukas Manfred Markus Matthias Monika Petra Sabine",
  "Stefan Ursula Uwe Wolfgang Bram Daan Jeroen Joost Maarten Pieter Sanne",
  "Sem Femke Anders Astrid Bjorn Erik Freya Gunnar Ingrid Lars Magnus Nils",
  "Olaf Sigrid Sven Thor Ulrika",
  // Slavic, Greek, Turkish.
  "Aleksandr Anastasia Andrei Boris Dmitri Elena Igor Irina Ivan Katarina",
  "Lukasz Marek Natasha Nikolai Olga Pavel Piotr Sergei Svetlana Tatiana",
  "Vladimir Yuri Zofia Agnieszka Tomasz Wojciech Dimitris Eleni Georgios",
  "Konstantinos Maria Nikos Sofia Yannis Ahmet Ayse Elif Emre Fatma",
  "Hasan Huseyin Mehmet Mustafa Zeynep",
  // Arabic, Persian, Hebrew.
  "Abdullah Ahmad Ahmed Ali Amina Aisha Fatima Hamza Hassan Hussein Ibrahim",
  "Khadija Khalid Layla Mahmoud Mariam Mohamed Mohammed Muhammad Mustafa",
  "Nour Omar Rania Salma Samir Tariq Yasmin Youssef Zainab Zahra Dariush",
  "Farhad Leila Mina Navid Parisa Reza Shirin Avi Chaim David Eli Moshe",
  "Noa Rivka Shira Tamar Yael Yosef",
  // South Asian.
  "Aarav Aditi Aditya Amit Anil Anita Anjali Arjun Deepak Dev Divya Ganesh",
  "Gaurav Kavya Krishna Lakshmi Manoj Meera Neha Nikhil Pooja Priya Rahul",
  "Raj Rajesh Ram Ravi Rohit Sanjay Sita Sunil Sunita Suresh Vijay Vikram",
  // East and Southeast Asian.
  "Hiroshi Kenji Haruto Yuki Sakura Takeshi Yuto Akira Aiko Hana Minato",
  "Ren Sora Wei Fang Jing Lei Li Ling Min Ming Na Ping Qiang Xiu Yan Yi",
  "Yong Hao Jun Mei Xin Ying Ji Hoon Jisoo Minjun Seojun Sung Hyun Jin",
  "Anh Binh Duc Hung Lan Linh Long Mai Minh Nam Phuong Thanh Trang Tuan",
  "Siti Budi Putri Agus Dewi Rizal Ayu Juan Jose Mark Joy",
  // African.
  "Abebe Adaeze Amara Ayodele Chinedu Chioma Kwame Kofi Ama Thabo Sipho",
  "Zanele Nomvula Tendai Wanjiru Kamau Amani Baraka",
].flatMap((line: string): Array<string> => {
  return line.split(" ");
});

export const FAMILY_NAMES: ReadonlyArray<string> = [
  // English.
  "Adams Allen Anderson Armstrong Bailey Baker Banks Barnes Bell Bennett",
  "Black Bond Brooks Brown Bryant Burke Bush Butler Campbell Carter",
  "Chambers Clark Cole Coleman Collins Cook Cooper Cox Crawford Cunningham",
  "Davies Davis Dixon Edwards Ellis Evans Fields Fisher Fleming Ford Foster",
  "Fowler Fox Fuller Gardner Gates Gibson Gordon Graham Grant Gray Green",
  "Griffin Hall Hamilton Harding Harris Harrison Hart Hayes Henderson",
  "Hill Holder Holmes Hooker Howard Hughes Hunt Hunter Jackson James",
  "Jenkins Johnson Jones Jordan Kelly Kennedy King Knight Lander Lane",
  "Lawrence Lee Lewis Lister Long Lovelace Marshall Martin Mason Masters",
  "Matthews Miller Mills Mitchell Moore Morgan Morris Murphy Murray Myers",
  "Nash Nelson Newman Owens Packer Page Palmer Parker Parks Patterson",
  "Payne Perry Peters Phillips Porter Powell Price Reed Reynolds Richards",
  "Richardson Rivers Roberts Robinson Rogers Ross Russell Sanders Scott",
  "Sellers Shaw Short Simmons Simpson Smith Spencer Stevens Stewart Stone",
  "Sullivan Taylor Thomas Thompson Tucker Turner Walker Wallace Ward",
  "Warren Washington Waters Watson Watts Webb Webber Wells West White",
  "Williams Wilson Wood Woods Wright Young Hopper Doe",
  // Spanish and Portuguese.
  "Alvarez Castillo Castro Cruz Diaz Fernandez Flores Garcia Gomez",
  "Gonzalez Gutierrez Hernandez Jimenez Lopez Martinez Mendoza Morales",
  "Moreno Munoz Navarro Ortiz Perez Ramirez Ramos Reyes Rodriguez Romero",
  "Ruiz Sanchez Torres Vargas Vasquez Almeida Alves Barbosa Carvalho",
  "Costa Ferreira Gomes Lima Martins Oliveira Pereira Ribeiro Rocha",
  "Santos Silva Sousa",
  // French, Italian, German, Dutch, Nordic.
  "Bernard Bertrand Bonnet Dubois Dupont Durand Fontaine Fournier Garnier",
  "Girard Lambert Laurent Lefebvre Leroy Martin Mercier Michel Moreau",
  "Petit Richard Robert Rousseau Roux Simon Thomas Vincent Bianchi Bruno",
  "Colombo Conti Costa Esposito Ferrari Galli Greco Lombardi Marino",
  "Ricci Romano Rossi Russo Bauer Becker Braun Fischer Hartmann Hoffmann",
  "Klein Koch Krause Lange Mayer Meier Meyer Muller Neumann Richter",
  "Schmidt Schmitt Schneider Schulz Schwarz Wagner Walter Weber Werner",
  "Wolf Zimmermann Bakker Bos Dekker Jansen Janssen Mulder Peeters",
  "Smit Visser Vos Andersen Andersson Berg Eriksson Hansen Johansson",
  "Karlsson Larsen Lindberg Nielsen Nilsson Olsen Pedersen Persson",
  "Svensson",
  // Slavic, Greek, Turkish.
  "Ivanov Kowalski Kozlov Kuznetsov Lewandowski Morozov Novak Novikov",
  "Nowak Petrov Popov Smirnov Sokolov Volkov Wisniewski Wojcik Horvat",
  "Kovacs Nagy Papadopoulos Georgiou Demir Kaya Ozturk Sahin Yilmaz Celik",
  // Arabic, Persian, Hebrew.
  "Abdullah Ahmadi Al Hassan Hussein Ibrahim Karimi Khalil Khan Mansour",
  "Mohammadi Nasser Rahman Saleh Hosseini Rezaei Cohen Levi Mizrahi",
  "Friedman Katz Goldberg",
  // South Asian.
  "Agarwal Banerjee Bhat Chopra Das Desai Gupta Iyer Joshi Kapoor Kumar",
  "Malhotra Mehta Menon Mishra Nair Patel Rao Reddy Shah Sharma Singh",
  "Verma",
  // East and Southeast Asian.
  "Chen Gao Guo He Hu Huang Li Lin Liu Luo Ma Sun Wang Wu Xu Yang Zhang",
  "Zhao Zhou Zhu Chan Wong Cheung Lau Leung Ng Abe Hayashi Inoue Ito",
  "Kato Kobayashi Matsumoto Nakamura Saito Sasaki Sato Suzuki Takahashi",
  "Tanaka Watanabe Yamada Yamaguchi Yamamoto Yoshida Choi Jung Kang Kim",
  "Lee Park Yoon Lim Han Shin Nguyen Tran Le Pham Hoang Huynh Phan Vu Vo",
  "Dang Bui Do Ho Ngo Duong Ly Santoso Wijaya Tan Lim Ong Cruz Reyes",
  "Bautista Garcia Mendoza",
  // African.
  "Adeyemi Okafor Okonkwo Mensah Boateng Dlamini Nkosi Ndlovu Mwangi",
  "Otieno Kamau Abebe Tesfaye Mohamud",
].flatMap((line: string): Array<string> => {
  return line.split(" ");
});
