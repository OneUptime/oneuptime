package io.hackerbay.fyipe.util;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.Scanner;

public class FileReader {
    public String readFile(String fileName) {
        String data = "";
        try {
            System.out.println(fileName);
            File myObj = new File(fileName);
            Scanner myReader = new Scanner(myObj);
            while (myReader.hasNextLine()) {
                System.out.println("reading");
                 data += myReader.nextLine();
            }
            myReader.close();
        } catch (FileNotFoundException e) {
            System.out.println("An error occurred reading file: "+fileName);
            e.printStackTrace();
        }
        return data;
    }
}
