for f in * ; do
    mv -- "$f" "$(tr [:lower:] [:upper:] <<< "${f:0:1}")${f:1}"
done