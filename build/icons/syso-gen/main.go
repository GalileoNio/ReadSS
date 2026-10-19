package main

import (
	"fmt"
	"os"

	"github.com/tc-hib/winres"
)

// Generates the Windows resource object that embeds the app icon into ReadS.exe.
// Wails v3 loads icon resource ID 3 for the window; ID 1 is the conventional
// shell/Explorer icon. Both point at the same multi-resolution ICO.
func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: icongen <icon.ico> <out.syso>")
		os.Exit(2)
	}

	f, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()

	ico, err := winres.LoadICO(f)
	if err != nil {
		panic(err)
	}

	rs := winres.ResourceSet{}
	for _, id := range []winres.Identifier{winres.ID(1), winres.ID(3)} {
		if err := rs.SetIcon(id, ico); err != nil {
			panic(err)
		}
	}

	out, err := os.Create(os.Args[2])
	if err != nil {
		panic(err)
	}
	defer out.Close()

	if err := rs.WriteObject(out, winres.ArchAMD64); err != nil {
		panic(err)
	}
	fmt.Println("wrote", os.Args[2])
}
