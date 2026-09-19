# README terminal demo for the `aconn` CLI. Render against the local emulators:
#   firebase emulators:start --only auth,firestore,functions   (in another shell)
#   cd scripts/demo && DEMO_DIR=$(mktemp -d) bash setup.sh && DEMO_DIR=$DEMO_DIR vhs aconn-demo.tape
# setup.sh symlinks bin/aconn.js into $DEMO_DIR/bin as `aconn` and copies answer.sh (the scripted human).
Output ../../docs/media/aconn-demo.gif

Require node

Set Shell "bash"
Set FontSize 17
Set Width 1100
Set Height 560
Set Padding 18
Set Theme "GitHub Dark"
Set TypingSpeed 40ms
Set Framerate 12
Set WaitTimeout 60s
Hide
Type "export AC_CONFIG_DIR=$DEMO_DIR PATH=$DEMO_DIR/bin:$PATH; cd $DEMO_DIR/repo; (DEMO_DIR=$DEMO_DIR bash $DEMO_DIR/answer.sh 4 >/dev/null 2>&1 &); clear"
Enter
Show

Type "aconn whoami"
Enter
Sleep 1.5s
Type "aconn read build --all"
Enter
Sleep 2.5s
Type "aconn ask deploy 'Ship build 42 to production?' --choices yes,no,later --timeout 60"
Enter
Wait+Screen /answered by/
Sleep 4s
