// Test-only Adobe boundary. All state lives beside this generated executable.
using System;
using System.IO;
class FakeUPIA {
    static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string state = Path.Combine(root, "installed.txt");
        string modePath = Path.Combine(root, "mode.txt");
        string mode = File.Exists(modePath) ? File.ReadAllText(modePath).Trim() : "ok";
        if (args.Length != 2) return 10;
        File.AppendAllText(Path.Combine(root, "calls.txt"), args[0] + "\n");
        if (args[0] == "/install") {
            if (mode == "fail-install") return 7;
            if (mode == "false-success") return 0;
            File.WriteAllText(state, File.ReadAllText(args[1]).Trim());
        } else if (args[0] == "/remove") {
            if (args[1] != "Layer Math") return 11;
            if (mode == "fail-remove") return 8;
            if (mode != "false-remove" && File.Exists(state)) File.Delete(state);
        } else if (args[0] == "/list") {
            if (mode == "fail-list") return 9;
            Console.WriteLine(" Enabled    Unrelated Plugin                     9.9.9");
            Console.WriteLine(" Enabled    Layer Math Extra                     9.9.9");
            if (File.Exists(state)) Console.WriteLine(" Enabled    Layer Math                           " + File.ReadAllText(state).Trim());
        } else return 12;
        return 0;
    }
}
